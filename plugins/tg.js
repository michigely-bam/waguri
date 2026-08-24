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

// ESTE ES EL ÚNICO CHAT DE WHATSAPP QUE RECIBIRÁ
// LAS RESPUESTAS DEL BOT DE TELEGRAM.
const CHAT_WA_DESTINO = process.env.WA_CHAT_DESTINO;

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan credenciales de Telegram en .env"
    );
}

if (!CHAT_WA_DESTINO) {
    console.error(
        "[TG] ❌ Falta WA_CHAT_DESTINO en .env"
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
// CONTROL DE DUPLICADOS
// ======================================================

const mensajesEnviados = new Set();

function registrarMensaje(id) {

    if (!id) return false;

    if (mensajesEnviados.has(id)) {
        return false;
    }

    mensajesEnviados.add(id);

    // Evitar que crezca indefinidamente
    if (mensajesEnviados.size > 1000) {

        const primero =
            mensajesEnviados.values().next().value;

        mensajesEnviados.delete(primero);
    }

    return true;
}

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
            `[TG] 🎯 Escuchando SOLO mensajes nuevos de ${TELEGRAM_DESTINO}`
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
//
// IMPORTANTE:
// NO usamos getMessages()
// NO leemos historial
// NO buscamos mensajes anteriores
//
// NewMessage solamente procesa eventos nuevos.
// ======================================================

telegramClient.addEventHandler(
    async event => {

        try {

            const msg =
                event?.message;

            if (!msg) return;

            // ==================================================
            // IGNORAR MENSAJES ENVIADOS POR NUESTRA CUENTA
            // ==================================================

            if (msg.out) {
                return;
            }

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
            // SOLO @MJnumbers_bot
            //
            // Todo lo demás se ignora silenciosamente.
            // ==================================================

            if (
                username !== "mjnumbers_bot"
            ) {
                return;
            }

            // ==================================================
            // EVITAR DUPLICADOS
            // ==================================================

            const messageId =
                String(msg.id || "");

            if (
                !registrarMensaje(messageId)
            ) {
                return;
            }

            // ==================================================
            // WHATSAPP DISPONIBLE
            // ==================================================

            if (!global.sock) {
                return;
            }

            if (!CHAT_WA_DESTINO) {
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
            // LOG ÚNICAMENTE DEL BOT
            // ==================================================

            console.log(
                `[TG → WA] 📥 @MJnumbers_bot: ${
                    texto
                        ? texto.substring(0, 100)
                        : "[multimedia]"
                }`
            );

            // ==================================================
            // MENSAJE SIN MEDIA
            // ==================================================

            if (!msg.media) {

                if (!texto.trim()) {
                    return;
                }

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        text: texto
                    }
                );

                console.log(
                    "[TG → WA] ✅ Enviado a WhatsApp"
                );

                return;
            }

            // ==================================================
            // DESCARGAR MEDIA
            // ==================================================

            let media;

            try {

                media =
                    await telegramClient.downloadMedia(
                        msg.media
                    );

            } catch {

                media = null;
            }

            // ==================================================
            // SI NO SE PUDO DESCARGAR
            // ==================================================

            if (!media) {

                if (texto.trim()) {

                    await global.sock.sendMessage(
                        CHAT_WA_DESTINO,
                        {
                            text: texto
                        }
                    );
                }

                return;
            }

            // ==================================================
            // DETECTAR TIPO DE MEDIA
            // ==================================================

            const mediaClass =
                msg.media.className || "";

            // ==================================================
            // FOTO
            // ==================================================

            if (
                mediaClass.includes("Photo")
            ) {

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        image: media,
                        caption:
                            texto || undefined
                    }
                );

                return;
            }

            // ==================================================
            // DOCUMENTO / ARCHIVO
            // ==================================================

            if (
                mediaClass.includes("Document") ||
                mediaClass.includes("File")
            ) {

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        document: media,
                        caption:
                            texto || undefined
                    }
                );

                return;
            }

            // ==================================================
            // OTRO TIPO
            // ==================================================

            await global.sock.sendMessage(
                CHAT_WA_DESTINO,
                {
                    document: media,
                    caption:
                        texto || undefined
                }
            );

        } catch (error) {

            // No saturar la consola
            console.log(
                "[TG → WA] ⚠️ Error:",
                error.message
            );
        }

    },

    new NewMessage({
        incoming: true
    })
);

// ======================================================
// PLUGIN /tg
// ======================================================

export default {

    name: "bridge",

    alias: [
        "tg",
        "send"
    ],

    description:
        "Envía mensajes de WhatsApp a Telegram",

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
        // MENSAJE VACÍO
        // ==================================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg /Get Number"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // ENVIAR A TELEGRAM
        // ==================================================

        try {

            await telegramClient.sendMessage(
                TELEGRAM_DESTINO,
                {
                    message: mensaje
                }
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `📡 *Enviado a Telegram*\n\n` +
                        `🎯 @MJnumbers_bot\n` +
                        `💬 ${mensaje}`
                },
                {
                    quoted: msg
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
                        `${error.message}`
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
