const express = require('express');
const { createRequire } = require('module');
const { distance: levenshteinDistance } = require('fastest-levenshtein');
require('dotenv').config();

const app = express();
app.use(express.json());

// Load configuration
const require = createRequire(import.meta.url);
const detectionConfig = require('./detectionConfig.json');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

async function analyzeUsername(username) {
    // Direct pattern matching
    const directMatch = detectionConfig.directPatterns.some(pattern => 
        username.toLowerCase().includes(pattern.toLowerCase())
    );
    if (directMatch) return { decision: 'UNSAFE', confidence: 1.0 };

    // Similarity check against known alts
    const closestAlt = detectionConfig.knownAlts.reduce((closest, alt) => {
        const distance = levenshteinDistance(username.toLowerCase(), alt.toLowerCase());
        const normalized = distance / Math.max(username.length, alt.length);
        return normalized < closest.distance ? 
            { distance: normalized, alt } : closest;
    }, { distance: Infinity, alt: '' });

    if (closestAlt.distance <= detectionConfig.maxEditDistance) {
        return { 
            decision: 'UNSAFE', 
            confidence: 1 - closestAlt.distance
        };
    }

    // Groq AI analysis
    try {
        const response = await fetch(GROQ_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: JSON.stringify({
                messages: [{
                    role: 'user',
                    content: `Analyze this Roblox username for Johnny Charlie patterns: ${username}. Respond ONLY with 'UNSAFE' or 'SAFE'.`
                }],
                model: detectionConfig.aiModel,
                temperature: detectionConfig.aiTemperature,
                max_tokens: 1
            })
        });

        const data = await response.json();
        const decision = data.choices[0]?.message?.content?.trim() || 'SAFE';
        
        return {
            decision: decision === 'UNSAFE' ? 'UNSAFE' : 'SAFE',
            confidence: decision === 'UNSAFE' ? 0.8 : 0.2
        };
    } catch (error) {
        console.error('Groq API error:', error);
        return { decision: 'SAFE', confidence: 0.0 };
    }
}

app.post('/check', async (req, res) => {
    const username = req.body?.username;
    
    if (!username) {
        return res.status(400).json({ error: 'No username provided' });
    }

    try {
        const { decision, confidence } = await analyzeUsername(username);
        res.json({
            username,
            decision,
            confidence: Number(confidence.toFixed(2)),
            model: detectionConfig.aiModel
        });
    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({ error: 'Analysis failed' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
