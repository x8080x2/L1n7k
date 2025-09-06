const express = require('express');
const cors = require('cors');
const path = require('path');
const { OutlookLoginAutomation } = require('./src/outlook-login');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active automation instances
const automationInstances = new Map();

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Outlook Automation Backend is running' });
});

// Start automation session
app.post('/api/start-session', async (req, res) => {
    try {
        const sessionId = Date.now().toString();
        const automation = new OutlookLoginAutomation();
        
        await automation.init();
        const navigated = await automation.navigateToOutlook();
        
        if (!navigated) {
            await automation.close();
            return res.status(500).json({ 
                error: 'Failed to navigate to Outlook' 
            });
        }

        automationInstances.set(sessionId, automation);
        
        // Take screenshot
        await automation.takeScreenshot(`screenshots/session-${sessionId}-initial.png`);

        res.json({
            sessionId,
            message: 'Automation session started successfully',
            screenshot: `screenshots/session-${sessionId}-initial.png`
        });

    } catch (error) {
        console.error('Error starting session:', error);
        res.status(500).json({ 
            error: 'Failed to start automation session',
            details: error.message 
        });
    }
});

// Perform login
app.post('/api/login', async (req, res) => {
    try {
        const { sessionId, email, password } = req.body;

        if (!sessionId || !email || !password) {
            return res.status(400).json({ 
                error: 'Missing required fields: sessionId, email, password' 
            });
        }

        const automation = automationInstances.get(sessionId);
        if (!automation) {
            return res.status(404).json({ 
                error: 'Session not found. Please start a new session.' 
            });
        }

        const loginSuccess = await automation.performLogin(email, password);
        
        // Take screenshot after login attempt
        await automation.takeScreenshot(`screenshots/session-${sessionId}-login.png`);

        if (loginSuccess) {
            res.json({
                success: true,
                message: 'Login successful',
                screenshot: `screenshots/session-${sessionId}-login.png`
            });
        } else {
            res.json({
                success: false,
                message: 'Login failed or additional authentication required',
                screenshot: `screenshots/session-${sessionId}-login.png`
            });
        }

    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ 
            error: 'Login process failed',
            details: error.message 
        });
    }
});

// Check emails
app.get('/api/emails/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const automation = automationInstances.get(sessionId);
        if (!automation) {
            return res.status(404).json({ 
                error: 'Session not found. Please start a new session.' 
            });
        }

        const emails = await automation.checkEmails();
        
        res.json({
            sessionId,
            emails,
            count: emails.length
        });

    } catch (error) {
        console.error('Error checking emails:', error);
        res.status(500).json({ 
            error: 'Failed to check emails',
            details: error.message 
        });
    }
});

// Take screenshot
app.post('/api/screenshot', async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ 
                error: 'Missing sessionId' 
            });
        }

        const automation = automationInstances.get(sessionId);
        if (!automation) {
            return res.status(404).json({ 
                error: 'Session not found' 
            });
        }

        const filename = `screenshots/session-${sessionId}-${Date.now()}.png`;
        await automation.takeScreenshot(filename);

        res.json({
            sessionId,
            screenshot: filename,
            message: 'Screenshot taken successfully'
        });

    } catch (error) {
        console.error('Error taking screenshot:', error);
        res.status(500).json({ 
            error: 'Failed to take screenshot',
            details: error.message 
        });
    }
});

// Close session
app.delete('/api/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;

        const automation = automationInstances.get(sessionId);
        if (!automation) {
            return res.status(404).json({ 
                error: 'Session not found' 
            });
        }

        await automation.close();
        automationInstances.delete(sessionId);

        res.json({
            sessionId,
            message: 'Session closed successfully'
        });

    } catch (error) {
        console.error('Error closing session:', error);
        res.status(500).json({ 
            error: 'Failed to close session',
            details: error.message 
        });
    }
});

// Get active sessions
app.get('/api/sessions', (req, res) => {
    const activeSessions = Array.from(automationInstances.keys());
    res.json({
        activeSessions,
        count: activeSessions.length
    });
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        details: err.message 
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down server...');
    
    // Close all active automation sessions
    for (const [sessionId, automation] of automationInstances.entries()) {
        try {
            console.log(`Closing session ${sessionId}...`);
            await automation.close();
        } catch (error) {
            console.error(`Error closing session ${sessionId}:`, error);
        }
    }
    
    automationInstances.clear();
    console.log('✅ All sessions closed. Server shutdown complete.');
    process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Outlook Automation Backend running on port ${PORT}`);
    console.log(`📧 API endpoints available at http://localhost:${PORT}/api/`);
    console.log(`🌐 Frontend available at http://localhost:${PORT}/`);
});