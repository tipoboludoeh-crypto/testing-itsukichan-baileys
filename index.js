import { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers,
    downloadMediaMessage  
} from '@itsukichan/baileys';
import pino from 'pino';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import qrcode from 'qrcode-terminal';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class WhatsAppBot {
    constructor() {
        this.sock = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 15000;
        this.init();
    }

    init() {
        this.showBanner();
    }

    showBanner() {
        console.clear();
        console.log('╔══════════════════════════════════════════════════╗');
        console.log('║           🤖 WHATSAPP BOT SIMPLE                 ║');
        console.log('║            📱 Solo conexión WhatsApp             ║');
        console.log('╚══════════════════════════════════════════════════╝');
        console.log('👻 Modo: Silencioso (sin notificaciones)');
        console.log('   Plataforma: Ubuntu/Linux');
        console.log('   Incluye prueba de botones Sí/No');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }

    async start() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(join(__dirname, 'session'));

            this.sock = makeWASocket({
                logger: pino({ level: 'silent' }),
                printQRInTerminal: false,
                auth: state,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                generateHighQualityLinkPreview: false,
                browser: Browsers.ubuntu('Chrome'),
                // version: [2, 3000, 1027934701], // descomentar si hay problemas de conexión
            });

            this.setupEventHandlers(saveCreds);
            
        } catch (error) {
            console.error('❌ Error al iniciar el bot:', error.message);
            this.reconnect();
        }
    }

    setupEventHandlers(saveCreds) {
        const sock = this.sock;

        // QR Code
        sock.ev.on('qr', (qr) => {
            console.clear();
            console.log('╔══════════════════════════════════════════════════╗');
            console.log('║                📱 ESCANEA EL QR                  ║');
            console.log('╚══════════════════════════════════════════════════╝\n');
            qrcode.generate(qr, { small: true });
            console.log('\n⚠️  Tienes 60 segundos para escanear el código QR');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        });

        // Estado de conexión
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                this.reconnectAttempts = 0;
                console.clear();
                
                console.log('╔══════════════════════════════════════════════════╗');
                console.log('║           ✅ CONEXIÓN EXITOSA                    ║');
                console.log('╚══════════════════════════════════════════════════╝\n');
                
                console.log(`👤 Usuario: ${sock.user?.name || 'Desconocido'}`);
                console.log(`📞 Número: ${sock.user?.id?.split(':')[0] || 'Cargando...'}`);
                console.log(`🕐 Conexión: ${new Date().toLocaleString('es-ES')}`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('🚀 Bot conectado correctamente');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === DisconnectReason.loggedOut) {
                    console.clear();
                    console.log('🔒 SESIÓN CERRADA MANUALMENTE\n');
                    console.log('Para reconectar: borra "session/" y ejecuta npm start');
                    process.exit(0);
                } else {
                    console.log(`\n⚠️ Desconectado (código: ${statusCode || 'desconocido'})`);
                    console.log(`⏳ Reconectando en 15 segundos...\n`);
                    this.reconnect();
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Pairing code (vinculación sin QR)
        sock.ev.on('connection.update', async (update) => {
            if (update.connection === 'connecting' && !sock.authState.creds.registered) {
                console.log('\n🔢 GENERANDO CÓDIGO DE VINCULACIÓN...');
                const phoneNumber = await this.askForPhoneNumber();
                if (phoneNumber) {
                    try {
                        const code = await sock.requestPairingCode(phoneNumber);
                        console.clear();
                        console.log('╔══════════════════════════════════════════════════╗');
                        console.log('║          📱 VINCULACIÓN SIN QR                  ║');
                        console.log('╚══════════════════════════════════════════════════╝\n');
                        console.log(`🔢 CÓDIGO: *${code}*\n`);
                        console.log('En WhatsApp → Ajustes → Dispositivos vinculados → Vincular con código');
                        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                    } catch (err) {
                        console.log('❌ Error generando código:', err.message);
                    }
                }
            }
        });

        // Manejo de mensajes + prueba de botones
        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;

                const messageType = Object.keys(msg.message)[0];
                const sender = msg.key.remoteJid.split('@')[0];
                const jid = msg.key.remoteJid;
                const now = new Date();

                console.log(`\n📩 MENSAJE RECIBIDO`);
                console.log(`👤 De: ${sender}`);
                console.log(`🕐 ${now.toLocaleTimeString('es-ES')}`);
                console.log(`📊 Tipo: ${messageType}`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

                // ── DETECCIÓN DE RESPUESTA A BOTÓN ───────────────────────────────
                if (messageType === 'buttonResponseMessage') {
                    const respuesta = msg.message.buttonResponseMessage.selectedButtonId;
                    console.log(`→ Usuario presionó botón: ${respuesta}`);

                    let textoRespuesta = 'Ok recibido';
                    if (respuesta === 'si_prueba' || respuesta.includes('si')) {
                        textoRespuesta = '¡Perfecto! Gracias por decir SÍ 😄';
                    } else if (respuesta === 'no_prueba' || respuesta.includes('no')) {
                        textoRespuesta = 'Entendido... Gracias por decir NO 😌';
                    }

                    await sock.sendMessage(jid, { text: textoRespuesta }, { quoted: msg });
                    return;
                }

                // ── ENVIAR MENSAJE CON BOTONES SÍ / NO COMO PRUEBA ───────────────
                await sock.sendMessage(jid, {
                    text: '¡Hola! Esta es una prueba de botones\n¿Te parece bien?',
                    footer: 'Responde con un botón ↓',
                    interactiveButtons: [
                        {
                            name: 'quick_reply',
                            buttonParamsJson: JSON.stringify({
                                display_text: 'Sí ✅',
                                id: 'si_prueba'
                            })
                        },
                        {
                            name: 'quick_reply',
                            buttonParamsJson: JSON.stringify({
                                display_text: 'No ❌',
                                id: 'no_prueba'
                            })
                        }
                    ]
                }, { quoted: msg });

                console.log(`✅ Botones Sí/No enviados a ${sender}`);

            } catch (error) {
                console.log(`\n⚠️ ERROR EN MENSAJE: ${error.message}`);
            }
        });
    }

    async askForPhoneNumber() {
        const readline = createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            readline.question('\n📱 Ingresa tu número (ej: 593967729399): ', (answer) => {
                readline.close();
                const cleaned = answer.replace(/[^\d]/g, '');
                if (cleaned.length >= 10 && cleaned.length <= 15) {
                    console.log(`✅ Número aceptado: ${cleaned}`);
                    resolve(cleaned);
                } else {
                    console.log('❌ Número inválido (10-15 dígitos)');
                    resolve(null);
                }
            });
        });
    }

    reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('\n❌ Límite de reconexiones alcanzado');
            console.log('Ejecuta npm start nuevamente o borra carpeta session/');
            process.exit(1);
        }
        this.reconnectAttempts++;
        console.log(`🔄 Reconexión ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        console.log(`⏳ Esperando ${this.reconnectDelay/1000} segundos...\n`);
        setTimeout(() => this.start(), this.reconnectDelay);
    }
}

// Cierre limpio
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
    process.on(signal, () => {
        console.clear();
        console.log('\n🛑 BOT DETENIDO');
        console.log(`Señal: ${signal} | ${new Date().toLocaleString('es-ES')}`);
        console.log('Para reiniciar → npm start');
        console.log('Para limpiar sesión → borra carpeta "session/"\n');
        process.exit(0);
    });
});

console.log('🚀 Iniciando WhatsApp Bot...\n');
const bot = new WhatsAppBot();
bot.start();