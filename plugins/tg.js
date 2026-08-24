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
const CHAT_WA_DESTINO = process.env.WA_CHAT_DESTINO;

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

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Solo escuchando @mjnumbers_bot`
        );

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando:",
            error.message
        );
    }
}

if (
    API_ID &&
    API_HASH &&
    STRING_SESSION
) {
    conectarTelegram();
}

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

telegramClient.addEventHandler(
    async event => {

        try {

            const msg =
                event.message;

            if (!msg) return;

            // Ignorar mensajes enviados por nuestra cuenta
            if (msg.out) return;

            // ==================================================
            // OBTENER REMITENTE
            // ==================================================

            let sender;

            try {

                sender =
                    await msg.getSender();

            } catch {

                return;
            }

            const username =
                sender?.username
                    ?.toLowerCase() || "";

            // ==================================================
            // FILTRO PRINCIPAL
            // SOLO MJNUMBERS_BOT
            // ==================================================

            if (
                username !==
                "mjnumbers_bot"
            ) {
                return;
            }

            // Desde aquí solamente se procesa
            // contenido de @MJnumbers_bot.

            console.log(
                "[TG → WA] 📥 Respuesta de @MJnumbers_bot"
            );

            // ==================================================
            // WHATSAPP
            // ==================================================

            if (!global.sock) {
                return;
            }

            const destino =
                global.TG_WA_CHAT ||
                CHAT_WA_DESTINO;

            if (!destino) {
                return;
            }

            // ==================================================
            // TEXTO
            // ==================================================

            const texto =
                msg.text ||
                msg.message ||
                "";

            // ==================================================
            // TEXTO SIN MULTIMEDIA
            // ==================================================

            if (!msg.media) {

                if (!texto.trim()) {
                    return;
                }

                await global.sock.sendMessage(
                    destino,
                    {
                        text:
                            `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                            `┊ ${texto}\n` +
                            `╰⋯ 》`
                    }
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
                if (
                    mediaClass.includes("Photo")
                ) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            image: media,
                            caption:
                                texto || undefined
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
                            caption:
                                texto || undefined
                        }
                    );
                }

                // OTRO
                else {

                    await global.sock.sendMessage(
                        destino,
                        {
                            document: media,
                            caption:
                                texto || undefined
                        }
                    );
                }

            } catch (mediaError) {

                console.error(
                    "[TG → WA] ❌ Error multimedia:",
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
                "[TG → WA] ❌ Error:",
                error.message
            );
        }

    },

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

        global.sock = sock;

        const from =
            msg.key.remoteJid;

        // El chat que ejecutó /tg recibirá la respuesta
        global.TG_WA_CHAT = from;

        const senderName =
            msg.pushName ||
            "Usuario";

        const mensaje =
            args
                .join(" ")
                .trim();

        // ==================================================
        // TELEGRAM
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
        // MENSAJE VACÍO
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

            if (
                quoted?.imageMessage
            ) {

                try {

                    const media =
                        await sock.downloadMediaMessage({

                            key: {
                                remoteJid:
                                    from,

                                id:
                                    contextInfo.stanzaId,

                                participant:
                                    contextInfo.participant
                            },

                            message:
                                quoted
                        });

                    await telegramClient.sendFile(
                        TELEGRAM_DESTINO,
                        {
                            file:
                                media,

                            caption:
                                `De WA: ${senderName}\n\n${mensaje}`
                        }
                    );

                    enviado = true;

                } catch (error) {

                    console.error(
                        "[TG] ❌ Error imagen:",
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
                        message:
                            mensaje
                    }
                );
            }

            // ==================================================
            // FINAL
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

                    edit:
                        key
                }
            );

        } catch (error) {

            console.error(
                "[TG] ❌ Error enviando:",
                error.message
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
