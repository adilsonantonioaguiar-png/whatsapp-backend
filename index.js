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
    const { sessionName, phoneNumber } = req.body;
    console.log('🔵 [start-session] Nova requisição:', { sessionName, phoneNumber });

    if (!sessionName) {
      return res.status(400).json({ error: 'sessionName é obrigatório' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ error: 'phoneNumber é obrigatório' });
    }

    // Verificar se sessão já existe
    if (sessions.has(sessionName)) {
      const existing = sessions.get(sessionName);
      console.log('ℹ️ Sessão já existe, retornando QR salvo:', existing.qrCode ? 'SIM' : 'NÃO');
      
      if (existing.qrCode) {
        return res.json({ qr: existing.qrCode, message: 'Sessão já existe' });
      } else {
        return res.status(202).json({ 
          error: 'QR ainda sendo gerado', 
          retryAfter: 2000 
        });
      }
    }

    const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionName}`);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      mobile: false,
      browser: ['WhatsApp CRM', 'Chrome', '1.0.0'],
    });

    // ✅ SALVAR SESSÃO IMEDIATAMENTE (sem QR ainda)
    const sessionData = { 
      sock, 
      qrCode: null, 
      phoneNumber,
      createdAt: new Date().toISOString() 
    };
    sessions.set(sessionName, sessionData);
    console.log('✅ Sessão criada e salva no Map:', sessionName, 'para', phoneNumber);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      console.log('🔁 [connection.update]', { sessionName, phoneNumber, connection, hasQR: !!qr });

      if (qr) {
        try {
          const qrCode = await QRCode.toDataURL(qr);
          const session = sessions.get(sessionName);
          if (session) {
            session.qrCode = qrCode;
            sessions.set(sessionName, session);
            console.log('✅ QR Code gerado e atualizado na sessão', sessionName);
          }
        } catch (err) {
          console.error('❌ Erro ao gerar QR Code:', err);
        }
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('🔴 Conexão fechada, reconectar?', shouldReconnect, 'sessão:', sessionName);

        if (!shouldReconnect) {
          sessions.delete(sessionName);
          console.log('🗑️ Sessão removida do Map:', sessionName);
        }
      } else if (connection === 'open') {
        console.log('🟢 Conexão aberta para', sessionName, '(', phoneNumber, ')');
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Esperar até 10 segundos pelo QR
    let attempts = 0;
    const maxAttempts = 20;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const session = sessions.get(sessionName);
      
      if (session?.qrCode) {
        console.log('✅ QR Code disponível após', attempts * 500, 'ms');
        return res.json({ qr: session.qrCode });
      }
      
      attempts++;
    }

    console.warn('⚠️ QR Code não disponível após 10 segundos para sessão', sessionName);
    return res.status(202).json({ 
      error: 'QR ainda sendo gerado',
      retryAfter: 2000,
      message: 'Tente novamente em alguns segundos'
    });

  } catch (error) {
    console.error('❌ Erro em /start-session:', error);
    return res.status(500).json({ error: 'Erro interno no backend', details: error.message });
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
    phoneNumber: session.phoneNumber,
  });
});

// Desconectar sessão
app.post('/logout/:sessionName', async (req, res) => {
  const { sessionName } = req.params;
  const session = sessions.get(sessionName);

  if (session) {
    try {
      await session.sock.logout();
      console.log('✅ Logout realizado:', sessionName);
    } catch (e) {
      console.error('❌ Erro ao deslogar sessão', sessionName, e);
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
    console.error('❌ Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend rodando na porta ${PORT}`);
});
