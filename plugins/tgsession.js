import fs from 'fs';
import path from 'path';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';

export default {
    name: 'tgsession',
    alias: ['telegramlogin'],
    description: 'Genera una String Session de Telegram',
    category: 'owner',

    async execute(sock, msg, options) {
        const {
            isOwner,
            config
        } = options;

        const jid = msg.key.remoteJid;

        if (!isOwner) {
            return await sock.sendMessage(jid, {
                text: '❌ Este comando es solo para el owner.'
            }, { quoted: msg });
        }

        const API_ID = Number(process.env.TELEGRAM_API_ID);
        const API_HASH = process.env.TELEGRAM_API_HASH;

        if (!API_ID || !API_HASH) {
            return await sock.sendMessage(jid, {
                text:
                    '❌ Faltan las credenciales de Telegram.\n\n' +
                    'Revisa tu .env:\n\n' +
                    'TELEGRAM_API_ID=...\n' +
                    'TELEGRAM_API_HASH=...'
            }, { quoted: msg });
        }

        try {
            await sock.sendMessage(jid, {
                text:
                    '📡 *Generador de sesión Telegram*\n\n' +
                    'Voy a iniciar la autenticación.\n\n' +
                    '⚠️ El número, código y contraseña se pedirán en la *consola del servidor*, no por WhatsApp.'
            }, { quoted: msg });

            const client = new TelegramClient(
                new StringSession(''),
                API_ID,
                API_HASH,
                {
                    connectionRetries: 5
                }
            );

            await client.start({
                phoneNumber: async () => {
                    console.log('\n📱 Escribe tu número de Telegram:');
                    return await preguntarConsola();
                },

                phoneCode: async () => {
                    console.log('\n🔐 Escribe el código recibido de Telegram:');
                    return await preguntarConsola();
                },

                password: async () => {
                    console.log('\n🔑 Escribe tu contraseña 2FA:');
                    return await preguntarConsola();
                },

                onError: (error) => {
                    console.error('❌ Error Telegram:', error);
                }
            });

            const session = client.session.save();

            console.log('\n========================================');
            console.log('✅ SESIÓN TELEGRAM GENERADA');
            console.log('========================================');
            console.log(session);
            console.log('========================================\n');

            const envPath = path.join(process.cwd(), '.env');

            let env = '';

            if (fs.existsSync(envPath)) {
                env = fs.readFileSync(envPath, 'utf8');
            }

            if (/^TELEGRAM_SESSION=.*$/m.test(env)) {
                env = env.replace(
                    /^TELEGRAM_SESSION=.*$/m,
                    `TELEGRAM_SESSION=${session}`
                );
            } else {
                if (env.length && !env.endsWith('\n')) {
                    env += '\n';
                }

                env += `TELEGRAM_SESSION=${session}\n`;
            }

            fs.writeFileSync(envPath, env);

            await client.disconnect();

            await sock.sendMessage(jid, {
                text:
                    '✅ *Sesión Telegram generada correctamente.*\n\n' +
                    'La `TELEGRAM_SESSION` fue guardada en `.env`.\n\n' +
                    '⚠️ No compartas esa sesión con nadie.'
            }, { quoted: msg });

        } catch (error) {
            console.error('❌ Error generando sesión:', error);

            await sock.sendMessage(jid, {
                text:
                    '❌ *Error generando la sesión:*\n\n' +
                    `${error.message || error}`
            }, { quoted: msg });
        }
    }
};

function preguntarConsola() {
    return new Promise((resolve) => {
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        process.stdin.once('data', (data) => {
            resolve(data.toString().trim());
        });
    });
}
