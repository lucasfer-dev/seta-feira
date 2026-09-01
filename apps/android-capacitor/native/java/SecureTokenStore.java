package com.sexta.assistant;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class SecureTokenStore {
    private static final String PREFS = "sexta_native";
    private static final String LEGACY_TOKEN = "owner_token";
    private static final String ENCRYPTED_TOKEN = "owner_token_aes_gcm";
    private static final String KEY_ALIAS = "sexta_owner_token_v1";

    private SecureTokenStore() {}

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return generator.generateKey();
    }

    public static synchronized void saveOwnerToken(Context context, String token) {
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String clean = token == null ? "" : token.trim();
        if (clean.isEmpty()) {
            prefs.edit().remove(ENCRYPTED_TOKEN).remove(LEGACY_TOKEN).apply();
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(clean.getBytes(StandardCharsets.UTF_8));
            ByteBuffer packed = ByteBuffer.allocate(1 + iv.length + ciphertext.length);
            packed.put((byte) iv.length).put(iv).put(ciphertext);
            prefs.edit().putString(ENCRYPTED_TOKEN, Base64.encodeToString(packed.array(), Base64.NO_WRAP)).remove(LEGACY_TOKEN).apply();
        } catch (Exception error) {
            throw new IllegalStateException("ANDROID_KEYSTORE_WRITE_FAILED", error);
        }
    }

    public static synchronized String getOwnerToken(Context context) {
        if (context == null) return "";
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String encrypted = prefs.getString(ENCRYPTED_TOKEN, "");
        if (encrypted != null && !encrypted.isEmpty()) {
            try {
                ByteBuffer packed = ByteBuffer.wrap(Base64.decode(encrypted, Base64.NO_WRAP));
                int ivLength = Byte.toUnsignedInt(packed.get());
                if (ivLength < 12 || ivLength > 16 || packed.remaining() <= ivLength) throw new IllegalArgumentException("TOKEN_BLOB_INVALID");
                byte[] iv = new byte[ivLength];
                packed.get(iv);
                byte[] ciphertext = new byte[packed.remaining()];
                packed.get(ciphertext);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
            } catch (Exception error) {
                prefs.edit().remove(ENCRYPTED_TOKEN).apply();
            }
        }
        String legacy = prefs.getString(LEGACY_TOKEN, "");
        if (legacy != null && !legacy.trim().isEmpty()) {
            saveOwnerToken(context, legacy);
            return legacy;
        }
        return "";
    }
}
