#!/bin/bash

# Test script for domain rotation functionality

echo "🔄 Testing Domain Rotation System"
echo "================================="

# Test URLs with 6-character strings (should rotate)
test_strings=("abc123" "def456" "ghi789" "jkl012" "mno345")

echo ""
echo "📋 Testing rotation with 6-character strings (should redirect):"
echo "----------------------------------------------------------------"

for string in "${test_strings[@]}"; do
    echo -n "Testing /$string: "
    response=$(curl -s -o /dev/null -w "%{http_code}|%{redirect_url}" "http://localhost:8080/$string")
    http_code=$(echo $response | cut -d'|' -f1)
    redirect_url=$(echo $response | cut -d'|' -f2)
    
    if [ "$http_code" = "302" ]; then
        echo "✅ Redirects to: $redirect_url"
    else
        echo "❌ No redirect (HTTP $http_code)"
    fi
done

echo ""
echo "📋 Testing normal requests (should serve content directly):"
echo "----------------------------------------------------------"

# Test normal URLs (should serve content directly)
test_urls=("/" "/about" "/api/health" "/test-page")

for url in "${test_urls[@]}"; do
    echo -n "Testing $url: "
    response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080$url")
    
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
invalid_strings=("abc12" "abcdefg" "12345" "ab-123")

for string in "${invalid_strings[@]}"; do
    echo -n "Testing /$string: "
    response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080/$string")
    
    if [ "$response" = "200" ] || [ "$response" = "404" ]; then
        echo "✅ Serves content (HTTP $response)"
    else
        echo "❌ Unexpected response (HTTP $response)"
    fi
done

echo ""
echo "✅ Test completed!"