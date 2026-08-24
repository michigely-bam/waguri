import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import "dotenv/config";

import fs from "fs";
import path from "path";

// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const STRING_SESSION = process.env.TELEGRAM_SESSION;

const TELEGRAM_DESTINO = "@TlgramMovieSearch_Bot";

// Archivo para guardar el último chat de WhatsApp
const DESTINO_FILE = path.resolve("./tg_destination.json");

// ======================================================
// ESTADO
// ======================================================

let telegramConectado = false;

// IMPORTANTE:
// Todo mensaje de Telegram anterior o igual a este timestamp
// será ignorado.
// Así no se reenvía historial al reiniciar.
let telegramInicio = 0;

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// CARGAR ÚLTIMO DESTINO
// ======================================================

function cargarDestino() {

    try {

        if (!fs.existsSync(DESTINO_FILE)) {
            return null;
        }

        const data =
            JSON.parse(
                fs.readFileSync(
                    DESTINO_FILE,
                    "utf8"
                )
            );

        if (
            data &&
            typeof data.chat === "string" &&
            data.chat.trim()
        ) {
            return data.chat;
        }

    } catch (error) {

        console.error(
            "[TG] ❌ Error leyendo destino:",
            error.message
        );
    }

    return null;
}

// ======================================================
// GUARDAR ÚLTIMO DESTINO
// ======================================================

function guardarDestino(chat) {

    try {

        fs.writeFileSync(
            DESTINO_FILE,
            JSON.stringify(
                {
                    chat,
                    actualizado: Date.now()
                },
                null,
                2
            )
        );

    } catch (error) {

        console.error(
            "[TG] ❌ Error guardando destino:",
            error.message
        );
    }
}

// ======================================================
// DESTINO ACTUAL
// ======================================================

let ultimoDestino = cargarDestino();

if (ultimoDestino) {

    console.log(
        `[TG] 📍 Último destino cargado: ${ultimoDestino}`
    );

}

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {

    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION"
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

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    try {

        await telegramClient.connect();

        /*
         * MUY IMPORTANTE
         *
         * Se establece DESPUÉS de conectar.
         *
         * Todo mensaje anterior a este momento
         * será ignorado.
         */
        telegramInicio =
            Math.floor(Date.now() / 1000);

        telegramConectado = true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Escuchando únicamente a ${TELEGRAM_DESTINO}`
        );

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
            error.message
        );
    }
}

// ======================================================
// CONECTAR
// ======================================================

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

            // ==================================================
            // IGNORAR MENSAJES ANTIGUOS
            // ==================================================

            if (
                msg.date &&
                msg.date <= telegramInicio
            ) {
                return;
            }

            // ==================================================
            // IGNORAR NUESTROS PROPIOS MENSAJES
            // ==================================================

            if (msg.out) {
                return;
            }

            // ==================================================
            // OBTENER REMITENTE
            // ==================================================

            let sender = null;

            try {

                sender =
                    await msg.getSender();

            } catch {

                return;
            }

            // ==================================================
            // USERNAME
            // ==================================================

            const username =
                sender?.username
                    ? String(sender.username).toLowerCase()
                    : "";

            // ==================================================
            // SOLO MJNUMBERS_BOT
            //
            // Los demás mensajes se ignoran completamente.
            // Sin logs.
            // ==================================================

            if (
                username !== "mjnumbers_bot"
            ) {
                return;
            }

            // ==================================================
            // COMPROBAR WHATSAPP
            // ==================================================

            if (!global.sock) {
                return;
            }

            // ==================================================
            // DESTINO
            //
            // Primero usamos el último /tg.
            // Si no existe, usamos el guardado.
            // ==================================================

            const destino =
                global.TG_WA_CHAT ||
                ultimoDestino;

            if (!destino) {

                console.log(
                    "[TG] ⚠️ MJnumbers respondió, pero todavía no existe un destino de WhatsApp."
                );

                return;
            }

            // ==================================================
            // GUARDAR DESTINO ACTUAL
            // ==================================================

            ultimoDestino =
                destino;

            // ==================================================
            // TEXTO
            // ==================================================

            const texto =
                String(
                    msg.text ||
                    msg.message ||
                    ""
                );

            // ==================================================
            // SIN MULTIMEDIA
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

                // ==================================================
                // SI NO SE PUDO DESCARGAR
                // ==================================================

                if (!media) {

                    if (
                        texto.trim()
                    ) {

                        await global.sock.sendMessage(
                            destino,
                            {
                                text:
                                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                    `┊ ${texto}\n` +
                                    `╰⋯ 》`
                            }
                        );
                    }

                    return;
                }

                const mediaClass =
                    msg.media?.className || "";

                // ==================================================
                // FOTO
                // ==================================================

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

                    return;
                }

                // ==================================================
                // DOCUMENTO
                // ==================================================

                if (
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

                    return;
                }

                // ==================================================
                // OTRO TIPO DE MULTIMEDIA
                // ==================================================

                await global.sock.sendMessage(
                    destino,
                    {
                        document: media,
                        caption:
                            texto || undefined
                    }
                );

            } catch (mediaError) {

                console.error(
                    "[TG] ❌ Error con multimedia:",
                    mediaError.message
                );

                // Si falló la multimedia pero existe texto,
                // mandamos solamente el texto.

                if (
                    texto.trim()
                ) {

                    await global.sock.sendMessage(
                        destino,
                        {
                            text:
                                `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                `┊ ${texto}\n` +
                                `╰⋯ 》`
                        }
                    );
                }
            }

        } catch (error) {

            console.error(
                "[TG] ❌ Error procesando mensaje:",
                error.message
            );
        }

    },

    new NewMessage({
        incoming: true
    })

);

// ======================================================
// PLUGIN WHATSAPP
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
        // GUARDAR SOCKET
        // ==================================================

        global.sock =
            sock;

        // ==================================================
        // OBTENER CHAT DE WHATSAPP
        // ==================================================

        const from =
            msg?.key?.remoteJid;

        if (!from) {
            return;
        }

        // ==================================================
        // ESTE ES EL NUEVO DESTINO
        //
        // Cada vez que uses /tg en un chat:
        // ese chat pasa a ser el destino.
        // ==================================================

        global.TG_WA_CHAT =
            from;

        ultimoDestino =
            from;

        // Guardarlo para sobrevivir reinicios
        guardarDestino(from);

        // ==================================================
        // NOMBRE
        // ==================================================

        const senderName =
            msg.pushName ||
            "Usuario";

        // ==================================================
        // MENSAJE
        // ==================================================

        const mensaje =
            Array.isArray(args)
                ? args.join(" ").trim()
                : String(args || "").trim();

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
        // SIN MENSAJE
        // ==================================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg /start"
                },
                {
                    quoted: msg
                }
            );
        }

        // ==================================================
        // PROGRESO
        // ==================================================

        const resultado =
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

        const progressKey =
            resultado?.key;

        try {

            let enviado =
                false;

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
                        await sock.downloadMediaMessage(
                            {
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
                            }
                        );

                    if (media) {

                        await telegramClient.sendFile(
                            TELEGRAM_DESTINO,
                            {
                                file:
                                    media,

                                caption:
                                    `De WA: ${senderName}\n\n${mensaje}`
                            }
                        );

                        enviado =
                            true;
                    }

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
                        message:
                            mensaje
                    }
                );
            }

            // ==================================================
            // PEQUEÑO DELAY
            // ==================================================

            await delay(800);

            // ==================================================
            // ACTUALIZAR PROGRESO
            // ==================================================

            if (progressKey) {

                try {

                    await sock.sendMessage(
                        from,
                        {
                            text:
                                `╭⋯ 📡 *ENVIADO* ⋯》\n` +
                                `┊ [██████] 100%\n` +
                                `┊ Destino: @MJnumbers_bot\n` +
                                `╰⋯ 》`,

                            edit:
                                progressKey
                        }
                    );

                } catch {

                    // Algunos forks de Baileys
                    // no soportan edit.
                }
            }

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
