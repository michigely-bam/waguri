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

// Último chat de WhatsApp usado con /tg
const DESTINO_FILE = path.resolve("./tg_destination.json");

// ======================================================
// ESTADO
// ======================================================

let telegramConectado = false;

// Último mensaje existente antes de activar el listener
let telegramUltimoId = 0;

// IDs ya procesados
const mensajesProcesados = new Set();

// Listener actual
let telegramHandler = null;
let telegramEvent = null;

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

if (
    !API_ID ||
    !API_HASH ||
    !STRING_SESSION
) {

    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION"
    );
}

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

const telegramClient = new TelegramClient(
    new StringSession(
        STRING_SESSION || ""
    ),
    API_ID || 0,
    API_HASH || "",
    {
        connectionRetries: 5
    }
);

// ======================================================
// OBTENER ÚLTIMO MENSAJE DEL BOT
// ======================================================

async function marcarHistorial() {

    try {

        const mensajes =
            await telegramClient.getMessages(
                TELEGRAM_DESTINO,
                {
                    limit: 1
                }
            );

        if (
            mensajes &&
            mensajes.length
        ) {

            telegramUltimoId =
                Number(
                    mensajes[0]?.id || 0
                );

        } else {

            telegramUltimoId = 0;
        }

    } catch (error) {

        telegramUltimoId = 0;

        console.error(
            "[TG] ⚠️ No se pudo marcar historial:",
            error.message
        );
    }
}

// ======================================================
// QUITAR LISTENER ANTERIOR
// ======================================================

function quitarListenerTelegram() {

    if (
        telegramHandler &&
        telegramEvent
    ) {

        try {

            telegramClient.removeEventHandler(
                telegramHandler,
                telegramEvent
            );

        } catch {}

    }

    telegramHandler = null;
    telegramEvent = null;
}

// ======================================================
// COMPROBAR MENSAJE
// ======================================================

async function esMensajeDeNox(msg) {

    if (!msg) {
        return false;
    }

    // Nunca procesar nuestros propios mensajes
    if (msg.out) {
        return false;
    }

    let sender;

    try {

        sender =
            await msg.getSender();

    } catch {

        return false;
    }

    const username =
        String(
            sender?.username || ""
        )
        .toLowerCase()
        .replace(/^@/, "");

    return username === "mjnumbers_bot";
}

// ======================================================
// ENVIAR TEXTO A WHATSAPP
// ======================================================

async function enviarTextoWhatsApp(
    destino,
    texto
) {

    if (
        !destino ||
        !texto ||
        !texto.trim()
    ) {
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
}

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

async function procesarTelegram(event) {

    try {

        const msg =
            event?.message;

        if (!msg) {
            return;
        }

        // ==================================================
        // ID
        // ==================================================

        const messageId =
            Number(
                msg.id || 0
            );

        if (!messageId) {
            return;
        }

        // ==================================================
        // BLOQUEAR HISTORIAL
        // ==================================================

        if (
            messageId <=
            telegramUltimoId
        ) {
            return;
        }

        // ==================================================
        // EVITAR DUPLICADOS
        // ==================================================

        if (
            mensajesProcesados.has(
                messageId
            )
        ) {
            return;
        }

        // Reservamos el ID inmediatamente
        mensajesProcesados.add(
            messageId
        );

        // Limpiar memoria
        if (
            mensajesProcesados.size > 1000
        ) {

            const ids =
                [...mensajesProcesados]
                    .slice(0, 500);

            for (
                const id of ids
            ) {

                mensajesProcesados.delete(
                    id
                );
            }
        }

        // ==================================================
        // SOLO @MJNUMBERS_BOT
        // ==================================================

        const correcto =
            await esMensajeDeNox(msg);

        if (!correcto) {
            return;
        }

        // ==================================================
        // SOCKET WHATSAPP
        // ==================================================

        if (!global.sock) {
            return;
        }

        // ==================================================
        // ÚLTIMO DESTINO
        // ==================================================

        const destino =
            global.TG_WA_CHAT ||
            ultimoDestino;

        if (!destino) {
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
        // SIN MULTIMEDIA
        // ==================================================

        if (!msg.media) {

            await enviarTextoWhatsApp(
                destino,
                texto
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

            // No se pudo descargar
            if (!media) {

                if (
                    texto.trim()
                ) {

                    await enviarTextoWhatsApp(
                        destino,
                        texto
                    );
                }

                return;
            }

            const mediaClass =
                String(
                    msg.media?.className ||
                    ""
                );

            // ==================================================
            // FOTO
            // ==================================================

            if (
                mediaClass.includes(
                    "Photo"
                )
            ) {

                await global.sock.sendMessage(
                    destino,
                    {
                        image: media,
                        caption:
                            texto ||
                            undefined
                    }
                );

                return;
            }

            // ==================================================
            // DOCUMENTO
            // ==================================================

            if (
                mediaClass.includes(
                    "Document"
                )
            ) {

                await global.sock.sendMessage(
                    destino,
                    {
                        document: media,
                        caption:
                            texto ||
                            undefined
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
                        texto ||
                        undefined
                }
            );

        } catch (error) {

            console.error(
                "[TG] ❌ Error multimedia:",
                error.message
            );

            if (
                texto.trim()
            ) {

                await enviarTextoWhatsApp(
                    destino,
                    texto
                );
            }
        }

    } catch (error) {

        console.error(
            "[TG] ❌ Error procesando respuesta:",
            error.message
        );
    }
}

// ======================================================
// INICIAR LISTENER
// ======================================================

function iniciarListenerTelegram() {

    // Primero eliminamos cualquier listener anterior
    quitarListenerTelegram();

    telegramEvent =
        new NewMessage({
            incoming: true
        });

    telegramHandler =
        async event => {

            await procesarTelegram(
                event
            );
        };

    telegramClient.addEventHandler(
        telegramHandler,
        telegramEvent
    );
}

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    try {

        // ==================================================
        // CONECTAR
        // ==================================================

        await telegramClient.connect();

        // ==================================================
        // IMPORTANTE
        // ==================================================
        //
        // NO usamos catchUp().
        //
        // Así no procesamos actualizaciones pendientes
        // que podrían corresponder a respuestas antiguas.
        //
        // ==================================================

        // ==================================================
        // MARCAR HISTORIAL ANTES DEL LISTENER
        // ==================================================

        await marcarHistorial();

        // ==================================================
        // LIMPIAR IDS
        // ==================================================

        mensajesProcesados.clear();

        // ==================================================
        // AHORA SÍ ESCUCHAR
        // ==================================================

        iniciarListenerTelegram();

        telegramConectado =
            true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            `[TG] 🎯 Solo @mjnumbers_bot`
        );

        if (ultimoDestino) {

            console.log(
                `[TG] 📍 Destino guardado: ${ultimoDestino}`
            );
        }

    } catch (error) {

        telegramConectado =
            false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
            error.message
        );
    }
}

// ======================================================
// INICIAR TELEGRAM
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

        // ==================================================
        // GUARDAR ÚLTIMO DESTINO
        // ==================================================

        global.TG_WA_CHAT =
            from;

        ultimoDestino =
            from;

        guardarDestino(
            from
        );

        // ==================================================
        // MENSAJE
        // ==================================================

        const senderName =
            msg.pushName ||
            "Usuario";

        const mensaje =
            Array.isArray(args)
                ? args.join(" ").trim()
                : String(
                    args || ""
                ).trim();

        // ==================================================
        // TELEGRAM CONECTADO
        // ==================================================

        if (
            !telegramConectado
        ) {

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

        let progress;

        try {

            progress =
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

        } catch {}

        // ==================================================
        // ENVIAR
        // ==================================================

        try {

            let enviado =
                false;

            // ==================================================
            // MENSAJE CITADO
            // ==================================================

            const contextInfo =
                msg?.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo
                    ?.quotedMessage;

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
                                        contextInfo?.stanzaId,

                                    participant:
                                        contextInfo?.participant
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

            await delay(500);

            // ==================================================
            // FINAL
            // ==================================================

            if (
                progress?.key
            ) {

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
                                progress.key
                        }
                    );

                } catch {}

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
