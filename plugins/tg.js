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

const TELEGRAM_DESTINO = "@MJnumbers_bot";

// Archivo donde se guarda el último chat de WhatsApp
const DESTINO_FILE = path.resolve("./tg_destination.json");

// ======================================================
// ESTADO
// ======================================================

let telegramConectado = false;

// ID del último mensaje que ya existía al conectar.
// Todo mensaje <= este ID será ignorado.
let telegramUltimoId = 0;

// Evita procesar dos veces el mismo mensaje
const mensajesProcesados = new Set();

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// DESTINO WHATSAPP
// ======================================================

function cargarDestino() {

    try {

        if (!fs.existsSync(DESTINO_FILE)) {
            return null;
        }

        const data = JSON.parse(
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
            "[TG] Error leyendo destino:",
            error.message
        );
    }

    return null;
}

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
            "[TG] Error guardando destino:",
            error.message
        );
    }
}

let ultimoDestino = cargarDestino();

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
// MARCAR EL HISTORIAL EXISTENTE
// ======================================================

async function marcarHistorial() {

    try {

        /*
         * Buscamos el último mensaje que YA EXISTE
         * en @MJnumbers_bot.
         *
         * Ese mensaje y todos los anteriores quedan
         * automáticamente bloqueados.
         */

        const mensajes =
            await telegramClient.getMessages(
                TELEGRAM_DESTINO,
                {
                    limit: 1
                }
            );

        if (
            Array.isArray(mensajes) &&
            mensajes.length > 0
        ) {

            const ultimo =
                mensajes[0];

            telegramUltimoId =
                Number(ultimo?.id || 0);

        } else {

            telegramUltimoId = 0;
        }

        console.log(
            `[TG] 🛡️ Historial protegido. Último ID ignorado: ${telegramUltimoId}`
        );

    } catch (error) {

        /*
         * Si por alguna razón no podemos obtener
         * el último mensaje, usamos 0.
         *
         * El filtro de fecha será la protección secundaria.
         */

        telegramUltimoId = 0;

        console.error(
            "[TG] ⚠️ No se pudo marcar el historial:",
            error.message
        );
    }
}

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

function iniciarListenerTelegram() {

    telegramClient.addEventHandler(

        async event => {

            try {

                const msg =
                    event?.message;

                if (!msg) {
                    return;
                }

                // ==================================================
                // ID DEL MENSAJE
                // ==================================================

                const messageId =
                    Number(msg.id || 0);

                /*
                 * BLOQUEO PRINCIPAL:
                 *
                 * Si el mensaje ya existía antes de conectar,
                 * nunca se envía a WhatsApp.
                 */

                if (
                    messageId &&
                    messageId <= telegramUltimoId
                ) {
                    return;
                }

                // ==================================================
                // EVITAR DUPLICADOS
                // ==================================================

                if (messageId) {

                    if (
                        mensajesProcesados.has(messageId)
                    ) {
                        return;
                    }

                    mensajesProcesados.add(
                        messageId
                    );

                    /*
                     * Evitamos que el Set crezca
                     * indefinidamente.
                     */

                    if (
                        mensajesProcesados.size > 500
                    ) {

                        const primeros =
                            [...mensajesProcesados]
                                .slice(0, 250);

                        for (
                            const id of primeros
                        ) {
                            mensajesProcesados.delete(id);
                        }
                    }
                }

                // ==================================================
                // IGNORAR MENSAJES ENVIADOS POR NOSOTROS
                // ==================================================

                if (msg.out) {
                    return;
                }

                // ==================================================
                // REMITENTE
                // ==================================================

                let sender = null;

                try {

                    sender =
                        await msg.getSender();

                } catch {

                    return;
                }

                // ==================================================
                // SOLO @MJnumbers_bot
                // ==================================================

                const username =
                    String(
                        sender?.username || ""
                    ).toLowerCase();

                if (
                    username !== "mjnumbers_bot"
                ) {
                    return;
                }

                // ==================================================
                // WHATSAPP
                // ==================================================

                if (!global.sock) {
                    return;
                }

                // ==================================================
                // DESTINO
                //
                // Último /tg usado.
                // ==================================================

                const destino =
                    global.TG_WA_CHAT ||
                    ultimoDestino;

                if (!destino) {

                    console.log(
                        "[TG] ⚠️ @MJnumbers_bot respondió, pero no existe destino de WhatsApp."
                    );

                    return;
                }

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
                // MENSAJE SIN MULTIMEDIA
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
                        String(
                            msg.media?.className || ""
                        );

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
                    // OTRO TIPO
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

                    /*
                     * Si la multimedia falla pero existe
                     * texto/caption, enviamos el texto.
                     */

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
}

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    try {

        /*
         * ==================================================
         * PASO 1
         * ==================================================
         *
         * Primero conectamos.
         */

        await telegramClient.connect();

        /*
         * ==================================================
         * PASO 2
         * ==================================================
         *
         * Ahora detectamos cuál era el último mensaje
         * existente ANTES de que el listener empiece.
         */

        await marcarHistorial();

        /*
         * ==================================================
         * PASO 3
         * ==================================================
         *
         * RECIÉN AHORA activamos NewMessage.
         *
         * Esto es lo que evita que el mensaje anterior
         * se reenvíe al iniciar/reiniciar el bot.
         */

        iniciarListenerTelegram();

        telegramConectado = true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Escuchando únicamente a @mjnumbers_bot`
        );

        if (ultimoDestino) {

            console.log(
                `[TG] 📍 Destino: ${ultimoDestino}`
            );
        }

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
            error.message
        );
    }
}

// ======================================================
// INICIAR
// ======================================================

if (
    API_ID &&
    API_HASH &&
    STRING_SESSION
) {

    conectarTelegram();

}

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
        // SOCKET
        // ==================================================

        global.sock =
            sock;

        // ==================================================
        // CHAT WHATSAPP
        // ==================================================

        const from =
            msg?.key?.remoteJid;

        if (!from) {
            return;
        }

        /*
         * Este chat pasa a ser el destino.
         *
         * Ejemplo:
         *
         * Grupo A → /tg /start
         *
         * Desde ahora las respuestas nuevas de
         * @MJnumbers_bot van al Grupo A.
         */

        global.TG_WA_CHAT =
            from;

        ultimoDestino =
            from;

        // Guardar para después de un reinicio
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

            let enviado = false;

            // ==================================================
            // CONTEXTO DEL MENSAJE CITADO
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
            // DELAY
            // ==================================================

            await delay(800);

            // ==================================================
            // FINAL
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
                    // Algunos forks no soportan edit.
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
