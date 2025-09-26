#!/bin/bash

# Test script for domain rotation functionality on Express server

echo "🔄 Testing Domain Rotation System"
echo "================================="
echo "Testing on port 5000 (Express server)"
echo ""

# Test URLs with 6-character strings (should rotate)
test_strings=("abc123" "def456" "ghi789" "jkl012" "mno345" "xyz999")

echo "📋 Testing rotation with 6-character strings (should redirect):"
echo "----------------------------------------------------------------"

for string in "${test_strings[@]}"; do
    echo -n "Testing /$string: "
    response=$(curl -s -o /dev/null -w "%{http_code}|%{redirect_url}" -L "http://localhost:5000/$string")
    http_code=$(echo $response | cut -d'|' -f1)
    redirect_url=$(echo $response | cut -d'|' -f2)
    
    if [ "$http_code" = "302" ]; then
        echo "✅ Redirects to: $redirect_url"
    elif [ "$redirect_url" != "" ]; then
        echo "✅ Redirect detected: $redirect_url (HTTP $http_code)"
    else
        echo "❌ No redirect (HTTP $http_code)"
    fi
done

echo ""
echo "📋 Testing normal requests (should serve content directly):"
echo "----------------------------------------------------------"

# Test normal URLs (should serve content directly)
test_urls=("/" "/api/health" "/ad.html")

for url in "${test_urls[@]}"; do
    echo -n "Testing $url: "
    response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5000$url")
    
    if [ "$response" = "200" ]; then
        echo "✅ Serves content (HTTP $response)"
    else
        echo "⚠️  HTTP $response"
    fi
done

echo ""
echo "🔍 Testing invalid strings (should serve content, not redirect):"
echo "----------------------------------------------------------------"

# Test invalid strings (not 6 characters, should serve content)
invalid_strings=("abc12" "abcdefg" "12345" "ab-123" "test")

for string in "${invalid_strings[@]}"; do
    echo -n "Testing /$string: "
    response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5000/$string")
    
    if [ "$response" = "200" ] || [ "$response" = "404" ]; then
        echo "✅ No redirect - serves content (HTTP $response)"
    else
        echo "❌ Unexpected response (HTTP $response)"
    fi
done

echo ""
echo "🔄 Testing rotation sequence (should show different domains):"
echo "------------------------------------------------------------"

# Test the same string multiple times to see rotation
test_string="test99"
echo "Testing /$test_string multiple times to verify rotation:"

for i in {1..6}; do
    echo -n "  Visit $i: "
    response=$(curl -s -I "http://localhost:5000/$test_string" | grep -i location | cut -d' ' -f2 | tr -d '\r\n')
    if [ "$response" != "" ]; then
        echo "→ $response"
    else
        echo "No redirect"
    fi
done

echo ""
echo "✅ Test completed!"