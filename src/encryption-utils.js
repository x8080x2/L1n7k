const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class EncryptionUtils {
    constructor() {
        this.encryptionKey = this.generateEncryptionKey();
    }

    // Generate encryption key using consistent method
    generateEncryptionKey() {
        const seed = process.env.ENCRYPTION_SEED || this.generateEncryptionSeed();
        const salt = 'salt';
        return crypto.scryptSync(seed, salt, 32);
    }

    // Auto-generate encryption seed if not provided
    generateEncryptionSeed() {
        const seedFile = path.join(process.cwd(), '.encryption-seed');
        
        if (fs.existsSync(seedFile)) {
            try {
                const existingSeed = fs.readFileSync(seedFile, 'utf8').trim();
                if (existingSeed && existingSeed.length >= 32) {
                    console.log('🔐 Using existing encryption seed from file');
                    return existingSeed;
                }
            } catch (error) {
                console.warn('⚠️ Error reading existing seed file:', error.message);
            }
        }
        
        // Generate new secure seed
        const newSeed = crypto.randomBytes(32).toString('hex');
        
        try {
            fs.writeFileSync(seedFile, newSeed, 'utf8');
            console.log('🔑 Generated new encryption seed and saved to file');
        } catch (error) {
            console.warn('⚠️ Could not save seed to file:', error.message);
        }
        
        return newSeed;
    }

    // Encrypt data using AES-256-GCM
    encryptData(text) {
        if (!text) return null;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    }

    // Decrypt data using AES-256-GCM
    decryptData(encryptedText) {
        if (!encryptedText) return null;
        try {
            const parts = encryptedText.split(':');
            if (parts.length !== 3) return null;
            
            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encrypted = parts[2];
            
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error.message);
            return null;
        }
    }

    // Encrypt entire JSON object
    encryptJSON(obj) {
        if (!obj) return null;
        return this.encryptData(JSON.stringify(obj));
    }

    // Decrypt entire JSON object
    decryptJSON(encryptedText) {
        const decrypted = this.decryptData(encryptedText);
        if (!decrypted) return null;
        try {
            return JSON.parse(decrypted);
        } catch (error) {
            console.error('JSON parse error after decryption:', error.message);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new EncryptionUtils();