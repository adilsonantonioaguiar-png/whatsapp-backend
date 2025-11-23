import express from 'express';
import cors from 'cors';
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';

const app = express();
app.use(cors());
app.use(express.json());

const sessions = new Map();

// Iniciar sessão
app.post('/start-session', async (req, res) => {
  const { sessionName } = req.body;

  if (sessions.has(sessionName)) {
    return res.json({ message: 'Sessão já existe' });
  }

  const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionName}`);
  
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' })
  });

  let qrCode = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = await QRCode.toDataURL(qr);
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada, reconectar?', shouldReconnect);
      
      if (shouldReconnect) {
        setTimeout(() => {
          // Reconectar automaticamente
        }, 5000);
      } else {
        sessions.delete(sessionName);
      }
    } else if (connection === 'open') {
      console.log('Conexão aberta para', sessionName);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sessions.set(sessionName, { sock, qrCode });

  await new Promise(resolve => setTimeout(resolve, 8000));

  const session = sessions.get(sessionName);
  res.json({ qr: session.qrCode });
});

// Verificar status
app.get('/status/:sessionName', (req, res) => {
  const { sessionName } = req.params;
  const session = sessions.get(sessionName);

  if (!session) {
    return res.json({ connected: false });
  }

  res.json({ 
    connected: session.sock.user ? true : false,
    user: session.sock.user 
  });
});

// Desconectar sessão
app.post('/logout/:sessionName', async (req, res) => {
  const { sessionName } = req.params;
  const session = sessions.get(sessionName);

  if (session) {
    await session.sock.logout();
    sessions.delete(sessionName);
  }

  res.json({ message: 'Desconectado' });
});

// Enviar mensagem
app.post('/send-message', async (req, res) => {
  const { sessionName, to, message } = req.body;
  const session = sessions.get(sessionName);

  if (!session || !session.sock.user) {
    return res.status(400).json({ error: 'Sessão não conectada' });
  }

  try {
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await session.sock.sendMessage(jid, { text: message });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
