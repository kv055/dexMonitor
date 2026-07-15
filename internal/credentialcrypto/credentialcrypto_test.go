package credentialcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"testing"
)

func TestDecryptV1(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	t.Setenv("APP_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(key))
	hash := sha256.Sum256(key)
	keyID := hex.EncodeToString(hash[:4])
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := make([]byte, gcm.NonceSize())
	plaintext := []byte("a@b.example")
	ciphertext := gcm.Seal(nil, nonce, plaintext, []byte(version+":"+keyID))
	encoded := version + ":" + keyID + ":" + base64.RawStdEncoding.EncodeToString(append(nonce, ciphertext...))
	got, err := Decrypt(encoded)
	if err != nil || got != string(plaintext) {
		t.Fatalf("Decrypt() = %q, %v", got, err)
	}
}

func TestDecryptPlaintextCompatibility(t *testing.T) {
	got, err := Decrypt("legacy@example.com")
	if err != nil || got != "legacy@example.com" {
		t.Fatalf("Decrypt() = %q, %v", got, err)
	}
}
