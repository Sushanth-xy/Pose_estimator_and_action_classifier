import numpy as np
import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, BatchNormalization
from tensorflow.keras.utils import to_categorical
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_class_weight
from sklearn.metrics import confusion_matrix, classification_report
import matplotlib.pyplot as plt
import seaborn as sns
import joblib
import os

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
X_PATH       = 'X_train_enhanced.npy'
Y_PATH       = 'y_train_enhanced.npy'
ACTIONS_PATH = 'action_names_filtered.npy'
MODEL_PATH   = 'pose_lstm_model.h5'
SCALER_PATH  = 'scaler.pkl'          # scaler saved here — needed at inference too
TEST_SIZE    = 0.2
BATCH_SIZE   = 32
EPOCHS       = 100
# ─────────────────────────────────────────


# 1. Load data
print("Loading data...")
X            = np.load(X_PATH)       # (samples, 60, 51)
y            = np.load(Y_PATH)
action_names = np.load(ACTIONS_PATH)
num_classes  = len(action_names)

print(f"  X shape      : {X.shape}")
print(f"  Actions      : {list(action_names)}")
print(f"  Samples/class: { {action_names[i]: int((y==i).sum()) for i in range(num_classes)} }\n")


# 2. Normalize features — fit scaler on train, apply to both splits
#    Reshape to 2D to fit scaler, then reshape back
samples, timesteps, features = X.shape
X_2d = X.reshape(-1, features)   # (samples*60, 51)

X_train_2d, X_val_2d, y_train, y_val = train_test_split(
    X_2d.reshape(samples, timesteps * features),
    y, test_size=TEST_SIZE, random_state=42, stratify=y
)

# Recover the (samples, timesteps, features) shape for splitting
X_train_raw = X_train_2d.reshape(-1, timesteps, features)
X_val_raw   = X_val_2d.reshape(-1, timesteps, features)

# Fit scaler only on train data
scaler  = StandardScaler()
n_train = X_train_raw.shape[0]
n_val   = X_val_raw.shape[0]

X_train_scaled = scaler.fit_transform(
    X_train_raw.reshape(-1, features)
).reshape(n_train, timesteps, features)

X_val_scaled = scaler.transform(
    X_val_raw.reshape(-1, features)
).reshape(n_val, timesteps, features)

joblib.dump(scaler, SCALER_PATH)
print(f"  Scaler fitted and saved to '{SCALER_PATH}'")
print(f"  Train samples: {n_train}  |  Val samples: {n_val}\n")

y_train_cat = to_categorical(y_train, num_classes)
y_val_cat   = to_categorical(y_val,   num_classes)


# 3. Class weights — compensate for imbalanced classes
class_weights_array = compute_class_weight(
    class_weight='balanced', classes=np.unique(y_train), y=y_train
)
class_weight_dict = {i: w for i, w in enumerate(class_weights_array)}
print(f"  Class weights: { {action_names[i]: round(w, 2) for i, w in class_weight_dict.items()} }\n")


# 4. Model
model = Sequential([
    LSTM(128, return_sequences=True, input_shape=(timesteps, features)),
    Dropout(0.3),
    BatchNormalization(),

    LSTM(256, return_sequences=True),
    Dropout(0.3),
    BatchNormalization(),

    LSTM(128, return_sequences=False),
    Dropout(0.3),
    BatchNormalization(),

    Dense(128, activation='relu'),
    Dropout(0.2),
    Dense(64, activation='relu'),
    Dense(num_classes, activation='softmax')
])

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss='categorical_crossentropy',
    metrics=['accuracy']
)

model.summary()


# 5. Callbacks
callbacks = [
    EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6, verbose=1),
    ModelCheckpoint(MODEL_PATH, monitor='val_accuracy', save_best_only=True, verbose=1)
]


# 6. Train
print("\nStarting training...")
history = model.fit(
    X_train_scaled, y_train_cat,
    epochs=EPOCHS,
    batch_size=BATCH_SIZE,
    validation_data=(X_val_scaled, y_val_cat),
    class_weight=class_weight_dict,
    callbacks=callbacks,
    verbose=1
)


# 7. Evaluate + confusion matrix
print("\nEvaluating on validation set...")
val_loss, val_acc = model.evaluate(X_val_scaled, y_val_cat, verbose=0)
print(f"  Val Loss     : {val_loss:.4f}")
print(f"  Val Accuracy : {val_acc*100:.2f}%")

y_pred = np.argmax(model.predict(X_val_scaled, verbose=0), axis=1)

print("\nClassification Report:")
print(classification_report(y_val, y_pred, target_names=action_names))

cm = confusion_matrix(y_val, y_pred)
plt.figure(figsize=(8, 6))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=action_names, yticklabels=action_names)
plt.title('Confusion Matrix')
plt.ylabel('True Label')
plt.xlabel('Predicted Label')
plt.tight_layout()
plt.savefig('confusion_matrix.png', dpi=150)
print("  Confusion matrix saved to 'confusion_matrix.png'")


# 8. Plot training history
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
ax1.plot(history.history['accuracy'],     label='Train')
ax1.plot(history.history['val_accuracy'], label='Val')
ax1.set_title('Accuracy')
ax1.set_xlabel('Epoch')
ax1.legend()

ax2.plot(history.history['loss'],     label='Train')
ax2.plot(history.history['val_loss'], label='Val')
ax2.set_title('Loss')
ax2.set_xlabel('Epoch')
ax2.legend()

plt.tight_layout()
plt.savefig('training_history.png', dpi=150)
print("  Training history saved to 'training_history.png'")

print(f"\n✅ Model saved to '{MODEL_PATH}'")
