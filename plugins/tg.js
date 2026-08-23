import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import "dotenv/config";

// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const STRING_SESSION = process.env.TELEGRAM_SESSION;

// Bot de Telegram al que se enviarán los mensajes
const TELEGRAM_DESTINO = "@MJnumbers_bot";

// JID de WhatsApp donde llegarán las respuestas
// CAMBIA ESTO por tu JID real
const CHAT_WA_DESTINO = process.env.WA_CHAT_DESTINO;

// ======================================================
// VALIDAR CONFIGURACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] Faltan variables de Telegram en el archivo .env"
    );
}

if (!CHAT_WA_DESTINO) {
    console.error(
        "[TG] Falta WA_CHAT_DESTINO en el archivo .env"
    );
}

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

const telegramClient = new TelegramClient(
    new StringSession(STRING_SESSION || ""),
    API_ID || 0,
    API_HASH || "",
    {}
);

let telegramConectado = false;

async function conectarTelegram() {
    try {
        await telegramClient.connect();

        telegramConectado = true;

        console.log(
            "✅ Puente WhatsApp → @MJnumbers_bot conectado"
        );
    } catch (error) {
        telegramConectado = false;

        console.error(
            "[TG] Error conectando Telegram:",
            error.message
        );
    }
}

if (API_ID && API_HASH && STRING_SESSION) {
    conectarTelegram();
}

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

telegramClient.addEventHandler(async update => {
    try {
        if (!update?.message) return;

        const msg = update.message;

        // Ignorar mensajes enviados por nuestra propia sesión
        if (msg.out) return;

        const sender = await msg.getSender();

        if (!sender) return;

        const username = sender.username
            ? sender.username.toLowerCase()
            : "";

        // Solo aceptar respuestas de MJnumbers_bot
        if (username !== "mjnumbers_bot") return;

        if (!global.sock) {
            console.log(
                "[TG] No hay conexión de WhatsApp disponible."
            );
            return;
        }

        let texto = msg.message || "";
        let media = null;

        // Descargar multimedia si existe
        if (msg.media) {
            try {
                media = await telegramClient.downloadMedia(
                    msg.media
                );
            } catch (error) {
                console.log(
                    "[TG] No se pudo descargar multimedia:",
                    error.message
                );
            }
        }

        // ==================================================
        // ENVIAR A WHATSAPP
        // ==================================================

        if (media) {
            await global.sock.sendMessage(
                CHAT_WA_DESTINO,
                {
                    image: media,
                    caption:
                        `╭⋯ 📥 *RESPUESTA DE @MJnumbers_bot* ⋯》\n` +
                        `┊ ${texto || "[Multimedia]"}\n` +
                        `╰⋯ 》`
                }
            );
        } else {
            await global.sock.sendMessage(
                CHAT_WA_DESTINO,
                {
                    text:
                        `╭⋯ 📥 *RESPUESTA DE @MJnumbers_bot* ⋯》\n` +
                        `┊ ${texto || "[Sin texto]"}\n` +
                        `╰⋯ 》`
                }
            );
        }

        console.log(
            "[TG] Respuesta de @MJnumbers_bot enviada a WhatsApp."
        );

    } catch (error) {
        console.error(
            "[TG] Error escuchando Telegram:",
            error.message
        );
    }
});

// ======================================================
// PLUGIN
// ======================================================

export default {
    name: "bridge",
    alias: ["tg", "send"],
    description: "Puente directo con @MJnumbers_bot",
    category: "herramientas",

    async execute(sock, msg, { args }) {

        global.sock = sock;

        const from = msg.key.remoteJid;
        const senderName = msg.pushName || "Usuario";
        const mensaje = args.join(" ").trim();

        if (!telegramConectado) {
            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ El puente de Telegram todavía no está conectado."
                },
                { quoted: msg }
            );
        }

        if (!CHAT_WA_DESTINO) {
            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Falta configurar `WA_CHAT_DESTINO` en el archivo `.env`."
                },
                { quoted: msg }
            );
        }

        if (!mensaje) {
            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        `${args.length ? "" : ".tg hola"}`
                },
                { quoted: msg }
            );
        }

        // ==================================================
        // MENSAJE DE PROGRESO
        // ==================================================

        const { key } = await sock.sendMessage(
            from,
            {
                text:
                    `╭⋯ 📡 *ENVIANDO A @MJnumbers_bot* ⋯》\n` +
                    `┊ [░░░░░░] 0%\n` +
                    `╰⋯ 》`
            },
            { quoted: msg }
        );

        try {

            // ==================================================
            // COMPROBAR SI ES RESPUESTA A UNA IMAGEN
            // ==================================================

            let enviado = false;

            const contextInfo =
                msg.message?.extendedTextMessage?.contextInfo;

            const quoted = contextInfo?.quotedMessage;

            if (quoted?.imageMessage) {

                try {

                    const media =
                        await sock.downloadMediaMessage({
                            key: {
                                remoteJid: from,
                                id: contextInfo.stanzaId,
                                participant:
                                    contextInfo.participant
                            },
                            message: quoted
                        });

                    await telegramClient.sendFile(
                        TELEGRAM_DESTINO,
                        {
                            file: media,
                            caption:
                                `De WA: ${senderName}\n\n${mensaje}`
                        }
                    );

                    enviado = true;

                } catch (error) {

                    console.log(
                        "[TG] Error enviando imagen:",
                        error.message
                    );
                }
            }

            // ==================================================
            // MENSAJE DE TEXTO
            // ==================================================

            if (!enviado) {

                await telegramClient.sendMessage(
                    TELEGRAM_DESTINO,
                    {
                        message:
                            `De WA: ${senderName}\n\n${mensaje}`
                    }
                );
            }

            // ==================================================
            // ACTUALIZAR PROGRESO
            // ==================================================

            await delay(800);

            await sock.sendMessage(
                from,
                {
                    text:
                        `╭⋯ 📡 *ENVIADO* ⋯》\n` +
                        `┊ [██████] 100%\n` +
                        `┊ Destino: @MJnumbers_bot\n` +
                        `╰⋯ 》`,
                    edit: key
                }
            );

        } catch (error) {

            console.error(
                "[TG] Error enviando:",
                error
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `❌ *Error enviando a Telegram*\n\n` +
                        `┊ ${error.message}`
                },
                { quoted: msg }
            );
        }
    }
};
