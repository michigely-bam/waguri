import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import "dotenv/config";

// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const STRING_SESSION = process.env.TELEGRAM_SESSION;

const TELEGRAM_DESTINO = "@MJnumbers_bot";

// Opcional: si existe, será el destino por defecto.
// Normalmente se usará global.TG_WA_CHAT.
const CHAT_WA_DESTINO = process.env.WA_CHAT_DESTINO;

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION"
    );
}

if (!CHAT_WA_DESTINO) {
    console.log(
        "[TG] ℹ️ WA_CHAT_DESTINO no configurado. Se usará el chat que ejecute /tg."
    );
}

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

const telegramClient = new TelegramClient(
    new StringSession(STRING_SESSION || ""),
    API_ID || 0,
    API_HASH || "",
    {
        connectionRetries: 5
    }
);

let telegramConectado = false;

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {
    try {
        await telegramClient.connect();

        telegramConectado = true;

        const me = await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Escuchando respuestas de ${TELEGRAM_DESTINO}`
        );

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
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
// IMPORTANTE:
// NewMessage es necesario para recibir mensajes nuevos.
// ======================================================

telegramClient.addEventHandler(
    async event => {

        try {

            const msg = event.message;

            if (!msg) return;

            // Ignorar mensajes enviados por nuestra propia cuenta
            if (msg.out) return;

            console.log(
                "[TG → WA] 📥 Nuevo mensaje recibido:",
                msg.text || "[multimedia]"
            );

            // ==================================================
            // OBTENER REMITENTE
            // ==================================================

            let sender = null;

            try {
                sender = await msg.getSender();
            } catch (error) {
                console.log(
                    "[TG → WA] ⚠️ No se pudo obtener sender:",
                    error.message
                );
            }

            const username =
                sender?.username
                    ? sender.username.toLowerCase()
                    : "";

            const firstName =
                sender?.firstName || "";

            console.log(
                `[TG → WA] 👤 Sender: @${username || "sin_username"} ${firstName}`
            );

            // ==================================================
            // SOLO MJNUMBERS_BOT
            // ==================================================

            if (username !== "mjnumbers_bot") {

                console.log(
                    "[TG → WA] ⏭️ Mensaje ignorado: no es @MJnumbers_bot"
                );

                return;
            }

            // ==================================================
            // COMPROBAR WHATSAPP
            // ==================================================

            if (!global.sock) {

                console.log(
                    "[TG → WA] ❌ global.sock todavía no existe."
                );

                return;
            }

            const destino =
                global.TG_WA_CHAT ||
                CHAT_WA_DESTINO;

            if (!destino) {

                console.log(
                    "[TG → WA] ❌ No hay destino de WhatsApp."
                );

                return;
            }

            console.log(
                "[TG → WA] 📍 Destino WhatsApp:",
                destino
            );

            // ==================================================
            // TEXTO
            // ==================================================

            const texto =
                msg.text ||
                msg.message ||
                "";

            // ==================================================
            // SIN MULTIMEDIA
            // ==================================================

            if (!msg.media) {

                if (!texto.trim()) return;

                await global.sock.sendMessage(
                    destino,
                    {
                        text:
                            `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                            `┊ ${texto}\n` +
                            `╰⋯ 》`
                    }
                );

                console.log(
                    "[TG → WA] ✅ Texto enviado a WhatsApp."
                );

                return;
            }

            // ==================================================
            // MULTIMEDIA
            // ==================================================

            try {

                const media =
                    await telegramClient.downloadMedia(
                        msg.media
                    );

                if (!media) {

                    if (texto.trim()) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                text: texto
                            }
                        );
                    }

                    return;
                }

                const mediaClass =
                    msg.media.className || "";

                // FOTO
                if (mediaClass.includes("Photo")) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            image: media,
                            caption: texto || undefined
                        }
                    );

                }

                // DOCUMENTO
                else if (
                    mediaClass.includes("Document")
                ) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            document: media,
                            caption: texto || undefined
                        }
                    );

                }

                // OTRO
                else {

                    await global.sock.sendMessage(
                        destino,
                        {
                            document: media,
                            caption: texto || undefined
                        }
                    );
                }

                console.log(
                    "[TG → WA] ✅ Multimedia enviada a WhatsApp."
                );

            } catch (mediaError) {

                console.error(
                    "[TG → WA] ❌ Error descargando multimedia:",
                    mediaError.message
                );

                if (texto.trim()) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            text: texto
                        }
                    );
                }
            }

        } catch (error) {

            console.error(
                "[TG → WA] ❌ Error procesando mensaje:",
                error
            );
        }

    },

    // ESTE ES EL CAMBIO IMPORTANTE
    new NewMessage({
        incoming: true
    })
);

// ======================================================
// PLUGIN
// ======================================================

export default {

    name: "bridge",

    alias: [
        "tg",
        "send"
    ],

    description:
        "Puente WhatsApp ↔ Telegram",

    category:
        "herramientas",

    command: [
        "tg",
        "send"
    ],

    async execute(
        sock,
        msg,
        { args }
    ) {

        // ==================================================
        // GUARDAR WHATSAPP
        // ==================================================

        global.sock = sock;

        const from =
            msg.key.remoteJid;

        // Este será el chat al que volverá la respuesta
        global.TG_WA_CHAT = from;

        const senderName =
            msg.pushName || "Usuario";

        const mensaje =
            args.join(" ").trim();

        // ==================================================
        // TELEGRAM CONECTADO
        // ==================================================

        if (!telegramConectado) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Telegram todavía no está conectado."
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // MENSAJE
        // ==================================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg memes"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // PROGRESO
        // ==================================================

        const { key } =
            await sock.sendMessage(
                from,
                {
                    text:
                        `╭⋯ 📡 *ENVIANDO A TELEGRAM* ⋯》\n` +
                        `┊ [░░░░░░] 0%\n` +
                        `╰⋯ 》`
                },
                {
                    quoted: msg
                }
            );

        try {

            let enviado = false;

            // ==================================================
            // MENSAJE CITADO
            // ==================================================

            const contextInfo =
                msg.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo?.quotedMessage;

            // ==================================================
            // IMAGEN CITADA
            // ==================================================

            if (quoted?.imageMessage) {

                try {

                    const media =
                        await sock.downloadMediaMessage({

                            key: {
                                remoteJid: from,

                                id:
                                    contextInfo.stanzaId,

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

                    console.error(
                        "[TG] ❌ Error enviando imagen:",
                        error.message
                    );
                }
            }

            // ==================================================
            // TEXTO
            // ==================================================

            if (!enviado) {

                await telegramClient.sendMessage(
                    TELEGRAM_DESTINO,
                    {
                        message: mensaje
                    }
                );
            }

            // ==================================================
            // PROGRESO FINAL
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

            console.log(
                `[TG] ✅ Mensaje enviado por ${senderName}: ${mensaje}`
            );

        } catch (error) {

            console.error(
                "[TG] ❌ Error enviando:",
                error
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `❌ *Error enviando a Telegram*\n\n` +
                        `┊ ${error.message}`
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
