# Domain Auto-Detection Implementation

## What Changed

Your ClosedBridge application now **automatically detects the domain** it's running on. No more hardcoding domains in configuration files!

## How It Works

### Server-Side Auto-Detection
The server automatically detects the domain from incoming HTTP request headers:

```javascript
// In server.js - line 537
const redirectUri = process.env.AZURE_REDIRECT_URI || 
    `${req.protocol}://${req.get('host')}/api/auth-callback`;
```

This means:
- **On Replit**: Uses your Replit domain automatically
- **On VPS with domain**: Uses chatterdrive.info or any other domain
- **On VPS with IP**: Uses the IP address
- **Multiple domains**: Works with ANY domain pointed to your server

### Updated VPS Install Script

The `vps-install.sh` script has been updated to **NOT hardcode** domains:

**Before:**
```bash
AZURE_REDIRECT_URI=https://chatterdrive.info/api/auth-callback
DOMAIN=https://chatterdrive.info
```

**After:**
```bash
# Domain auto-detection: Server automatically detects from request headers
# No need to hardcode AZURE_REDIRECT_URI or DOMAIN
```

## Benefits

1. ✅ **One deployment works everywhere**
   - Same code on Replit, VPS, multiple domains
   - No reconfiguration needed when changing domains

2. ✅ **Azure credentials stay hidden**
   - Backend secrets (AZURE_CLIENT_ID, etc.) remain server-side in .env
   - Users never see these credentials
   - Auto-generated ADMIN_TOKEN for security

3. ✅ **Easy domain changes**
   - Point a new domain to your VPS
   - It just works - no .env updates needed
   - SSL works with any domain

4. ✅ **Multi-domain support**
   - Run the same app on multiple domains
   - Each request uses the correct domain automatically

## What's Still in .env

Backend secrets that SHOULD be server-side only:

```env
# Backend Azure credentials (never exposed to users)
AZURE_CLIENT_ID=34dc06b1-d91e-4408-b353-528722266c04
AZURE_CLIENT_SECRET=05a49988-1efb-4952-88cc-cb04e9f4c099
AZURE_TENANT_ID=29775c6a-2d6e-42ef-a6ea-3e0a46793619

# Auto-generated admin token
ADMIN_TOKEN=admin-xxxxxxxxxxxxxx

# Server configuration
PORT=5000
```

These are YOUR backend credentials for YOUR Azure app registration - not user credentials.

## Using the Updated Install Script

```bash
# Download and run - domain is auto-detected
cd /root
wget https://raw.githubusercontent.com/x8080x2/L1n7k/main/vps-install.sh
sudo bash vps-install.sh

# Enter your domain (for SSL certificate)
# The app will auto-detect and work with it

# To add SSL to a different domain later:
sudo bash vps-install.sh --configure-domain
```

## Testing

Your app will respond with the correct domain for:
- OAuth redirect URIs
- API endpoints
- Telegram webhooks
- Any other domain-dependent features

No manual configuration needed! 🎉
