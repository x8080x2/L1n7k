#!/bin/bash

echo "🌐 Setting up Nginx reverse proxy for winlearnchange.info..."

# Install nginx if not already installed
echo "📦 Installing nginx..."
sudo apt update && sudo apt install nginx -y

# Copy the nginx config to the correct location
echo "⚙️ Setting up nginx configuration..."
sudo cp nginx-winlearnchange.info.conf /etc/nginx/sites-available/winlearnchange.info

# Enable the site
echo "✅ Enabling site..."
sudo ln -sf /etc/nginx/sites-available/winlearnchange.info /etc/nginx/sites-enabled/

# Remove default nginx site to avoid conflicts
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
echo "🧪 Testing nginx configuration..."
if sudo nginx -t; then
    echo "✅ Nginx configuration is valid"
    
    # Restart nginx
    echo "🔄 Restarting nginx..."
    sudo systemctl restart nginx
    sudo systemctl enable nginx
    
    echo ""
    echo "🎉 Nginx setup complete!"
    echo "✅ Your domain winlearnchange.info will now proxy to localhost:3000"
    echo "✅ Make sure your app is running on port 3000"
    echo ""
    echo "Next steps:"
    echo "1. Start your app: npm start"
    echo "2. Visit: http://winlearnchange.info"
    
else
    echo "❌ Nginx configuration test failed"
    echo "Please check the configuration and try again"
    exit 1
fi