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
  try {
    const { sessionName } = req.body;
    console.log('🔵 [start-session] Nova requisição para sessão:', sessionName);

    if (!sessionName) {
      return res.status(400).json({ error: 'sessionName é obrigatório' });
    }

    if (sessions.has(sessionName)) {
      const existing = sessions.get(sessionName);
      console.log('ℹ️ Sessão já existe, retornando QR salvo (se houver)');
      return res.json({ qr: existing.qrCode || null, message: 'Sessão já existe' });
    }

    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionName}`);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });

    let qrCode = null;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('🔁 [connection.update]', { sessionName, connection, hasQR: !!qr });

      if (qr) {
        try {
          qrCode = await QRCode.toDataURL(qr);
          // ⚠️ IMPORTANTE: só salvamos a sessão aqui, DEPOIS de ter o QR
          sessions.set(sessionName, { sock, qrCode });
          console.log('✅ QR Code gerado e salvo para sessão', sessionName);
        } catch (err) {
          console.error('Erro ao gerar QR Code:', err);
        }
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('🔴 Conexão fechada, reconectar?', shouldReconnect, 'sessão:', sessionName);

        if (!shouldReconnect) {
          sessions.delete(sessionName);
        }
      } else if (connection === 'open') {
        console.log('🟢 Conexão aberta para', sessionName);
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Espera alguns segundos para o QR ser gerado
    await new Promise((resolve) => setTimeout(resolve, 8000));

    const savedSession = sessions.get(sessionName);
    const finalQr = savedSession?.qrCode || qrCode;

    if (!finalQr) {
      console.warn('⚠️ QR Code ainda não disponível para sessão', sessionName);
      return res.status(500).json({ error: 'QR Code não foi gerado pelo backend' });
    }

    return res.json({ qr: finalQr });
  } catch (error) {
    console.error('❌ Erro em /start-session:', error);
    return res.status(500).json({ error: 'Erro interno no backend' });
  }
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
    user: session.sock.user,
  });
});

// Desconectar sessão
app.post('/logout/:sessionName', async (req, res) => {
  const { sessionName } = req.params;
  const session = sessions.get(sessionName);

  if (session) {
    try {
      await session.sock.logout();
    } catch (e) {
      console.error('Erro ao deslogar sessão', sessionName, e);
    }
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
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
