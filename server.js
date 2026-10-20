require('dotenv').config();
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Conectare MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectat la MongoDB cu succes!'))
  .catch(err => console.error('❌ Eroare conectare MongoDB:', err));

const UserSchema = new mongoose.Schema({
  discordId: { type: String, unique: true },
  username: String,
  accessToken: String,
  refreshToken: String,
  verifiedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// Ruta de verificare
app.get('/verify', (req, res) => {
  const redirectUri = "https://verificationg3nhydrabot.onrender.com/api/callback";
  const authorizeUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=identify%20guilds.join`;
  res.redirect(authorizeUrl);
});

// Callback-ul de la Discord
app.get('/api/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Cod de autorizare lipsă.');

  try {
    const tokenParams = new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.REDIRECT_URI,
    });

    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', tokenParams, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, refresh_token } = tokenResponse.data;

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const userData = userResponse.data;

    await User.findOneAndUpdate(
      { discordId: userData.id },
      {
        discordId: userData.id,
        username: `${userData.username}`,
        accessToken: access_token,
        refreshToken: refresh_token,
        verifiedAt: new Date()
      },
      { upsert: true, new: true }
    );

    res.send('<h2>✅ Verificare reusita! Poti inchide aceasta fereastra.</h2>');
  } catch (error) {
    console.error('Eroare OAuth2:', error.response?.data || error.message);
  }
});

app.get('/api/stats', async (req, res) => {
  if (req.query.key !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Cheie invalida.' });
  const count = await User.countDocuments();
  res.json({ totalVerified: count });
});

app.post('/api/pull', async (req, res) => {
  const { adminKey, targetGuildId } = req.body;
  if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Cheie invalida.' });
  if (!targetGuildId) return res.status(400).json({ error: 'Specifică ID-ul serverului.' });

  const users = await User.find();
  let success = 0, failed = 0;

  res.write(JSON.stringify({ status: 'started', total: users.length }) + '\n');

  for (const user of users) {
    try {
      await axios.put(
        `https://discord.com/api/v10/guilds/${targetGuildId}/members/${user.discordId}`,
        { access_token: user.accessToken },
        { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      success++;
    } catch (err) {
      failed++;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  res.write(JSON.stringify({ status: 'completed', success, failed }) + '\n');
  res.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serverul rulează pe portul ${PORT}`));
