import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
import { NewMessage } from "teleproto/events/index.js";
import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
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

const DESTINO_FILE =
    path.resolve("./tg_destination.json");

// ======================================================
// ESTADO
// ======================================================

let telegramConectado = false;

let telegramUltimoId = 0;

const mensajesProcesados =
    new Set();

/*
 * Aquí guardamos la relación:
 *
 * botón WhatsApp
 *        ↓
 * mensaje Telegram
 *        ↓
 * callback_data original
 */
const botonesTelegram =
    new Map();

let contadorBotones = 0;

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve =>
        setTimeout(resolve, ms)
    );

// ======================================================
// DESTINO
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

let ultimoDestino =
    cargarDestino();

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

const telegramClient =
    new TelegramClient(
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
// HISTORIAL
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
            Array.isArray(mensajes) &&
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
            "[TG] ⚠️ Error marcando historial:",
            error.message
        );
    }
}

// ======================================================
// BOTONES TELEGRAM → WHATSAPP
// ======================================================

function obtenerBotonesTelegram(msg) {

    const resultado = [];

    const rows =
        msg?.replyMarkup?.rows || [];

    for (
        const row of rows
    ) {

        const buttons =
            row?.buttons || [];

        for (
            const button of buttons
        ) {

            /*
             * Los botones callback de Telegram
             * tienen .data.
             */

            if (!button?.data) {
                continue;
            }

            const texto =
                String(
                    button.text || "Opción"
                );

            const callbackData =
                Buffer.from(
                    button.data
                );

            const id =
                `tgcb_${Date.now()}_${++contadorBotones}`;

            botonesTelegram.set(
                id,
                {
                    peer:
                        TELEGRAM_DESTINO,

                    msgId:
                        Number(msg.id),

                    data:
                        callbackData
                }
            );

            resultado.push({
                buttonId:
                    id,

                buttonText: {
                    displayText:
                        texto
                },

                type: 1
            });

            /*
             * ButtonsMessage de WhatsApp
             * trabaja mejor con pocos botones.
             */
            if (resultado.length >= 3) {
                break;
            }
        }

        if (resultado.length >= 3) {
            break;
        }
    }

    /*
     * Limpiar botones antiguos.
     */

    if (
        botonesTelegram.size > 300
    ) {

        const claves =
            [...botonesTelegram.keys()]
                .slice(0, 150);

        for (
            const clave of claves
        ) {
            botonesTelegram.delete(
                clave
            );
        }
    }

    return resultado;
}

// ======================================================
// ENVIAR TELEGRAM → WHATSAPP
// ======================================================

async function enviarTelegramWhatsApp(
    msg,
    destino
) {

    if (!global.sock) {
        return;
    }

    const texto =
        String(
            msg?.text ||
            msg?.message ||
            ""
        );

    const botones =
        obtenerBotonesTelegram(msg);

    // ==================================================
    // BOTONES
    // ==================================================

    if (botones.length) {

        const contenido =
            generateWAMessageFromContent(
                destino,
                {
                    buttonsMessage: {
                        contentText:
                            texto ||
                            "Selecciona una opción",

                        footerText:
                            "✦ Telegram ↔ WhatsApp ✦",

                        buttons:
                            botones,

                        headerType: 1
                    }
                },
                {}
            );

        await global.sock.relayMessage(
            destino,
            contenido.message,
            {
                messageId:
                    contenido.key.id
            }
        );

        return;
    }

    // ==================================================
    // TEXTO
    // ==================================================

    if (
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

function iniciarListenerTelegram() {

    telegramClient.addEventHandler(

        async event => {

            try {

                const msg =
                    event?.message;

                if (!msg) {
                    return;
                }

                const messageId =
                    Number(msg.id || 0);

                /*
                 * NO procesar mensajes anteriores
                 * al arranque.
                 */

                if (
                    messageId &&
                    messageId <=
                    telegramUltimoId
                ) {
                    return;
                }

                /*
                 * Anti-duplicados.
                 */

                if (messageId) {

                    if (
                        mensajesProcesados.has(
                            messageId
                        )
                    ) {
                        return;
                    }

                    mensajesProcesados.add(
                        messageId
                    );
                }

                /*
                 * No procesar nuestros mensajes.
                 */

                if (msg.out) {
                    return;
                }

                // ==================================================
                // REMITENTE
                // ==================================================

                let sender;

                try {

                    sender =
                        await msg.getSender();

                } catch {

                    return;
                }

                const username =
                    String(
                        sender?.username || ""
                    ).toLowerCase();

                /*
                 * SOLO @MJnumbers_bot
                 */

                if (
                    username !==
                    "mjnumbers_bot"
                ) {
                    return;
                }

                if (!global.sock) {
                    return;
                }

                const destino =
                    global.TG_WA_CHAT ||
                    ultimoDestino;

                if (!destino) {
                    return;
                }

                // ==================================================
                // TELEGRAM → WHATSAPP
                // ==================================================

                if (
                    msg.replyMarkup?.rows?.length
                ) {

                    await enviarTelegramWhatsApp(
                        msg,
                        destino
                    );

                    return;
                }

                // ==================================================
                // MULTIMEDIA
                // ==================================================

                if (msg.media) {

                    try {

                        const media =
                            await telegramClient.downloadMedia(
                                msg.media
                            );

                        if (!media) {
                            return;
                        }

                        const texto =
                            String(
                                msg.text ||
                                msg.message ||
                                ""
                            );

                        const mediaClass =
                            String(
                                msg.media?.className ||
                                ""
                            );

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

                    } catch (error) {

                        console.error(
                            "[TG] Error multimedia:",
                            error.message
                        );

                        return;
                    }
                }

                // ==================================================
                // TEXTO
                // ==================================================

                await enviarTelegramWhatsApp(
                    msg,
                    destino
                );

            } catch (error) {

                console.error(
                    "[TG] Error procesando:",
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
// WHATSAPP → TELEGRAM
// CAPTURA DE BOTONES
// ======================================================

function instalarListenerWhatsApp(
    sock
) {

    /*
     * Evitar instalar el listener varias veces
     * si haces reload del plugin.
     */

    if (
        global.__TG_BRIDGE_WA_LISTENER__ ===
        sock
    ) {
        return;
    }

    global.__TG_BRIDGE_WA_LISTENER__ =
        sock;

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

            try {

                for (
                    const m of messages
                ) {

                    if (!m?.message) {
                        continue;
                    }

                    const remoteJid =
                        m.key?.remoteJid;

                    if (!remoteJid) {
                        continue;
                    }

                    let buttonId =
                        null;

                    // ==================================================
                    // BOTÓN NORMAL
                    // ==================================================

                    if (
                        m.message
                            ?.buttonsResponseMessage
                    ) {

                        buttonId =
                            m.message
                                .buttonsResponseMessage
                                .selectedButtonId;
                    }

                    // ==================================================
                    // BOTÓN TEMPLATE
                    // ==================================================

                    if (
                        !buttonId &&
                        m.message
                            ?.templateButtonReplyMessage
                    ) {

                        buttonId =
                            m.message
                                .templateButtonReplyMessage
                                .selectedId;
                    }

                    // ==================================================
                    // BOTÓN INTERACTIVO
                    // ==================================================

                    if (
                        !buttonId &&
                        m.message
                            ?.interactiveResponseMessage
                    ) {

                        const params =
                            m.message
                                .interactiveResponseMessage
                                ?.nativeFlowResponseMessage
                                ?.paramsJson;

                        if (params) {

                            try {

                                const data =
                                    JSON.parse(
                                        params
                                    );

                                buttonId =
                                    data.id ||
                                    data.button_id ||
                                    data.selected_id;

                            } catch {
                                // Ignorar formato inválido
                            }
                        }
                    }

                    if (!buttonId) {
                        continue;
                    }

                    /*
                     * ¿Es uno de nuestros botones
                     * Telegram → WhatsApp?
                     */

                    const callback =
                        botonesTelegram.get(
                            buttonId
                        );

                    if (!callback) {
                        continue;
                    }

                    /*
                     * El botón ya fue utilizado.
                     * Lo eliminamos para evitar doble ejecución.
                     */

                    botonesTelegram.delete(
                        buttonId
                    );

                    console.log(
                        `[TG] 🔘 Botón seleccionado: ${buttonId}`
                    );

                    // ==================================================
                    // EJECUTAR CALLBACK REAL DE TELEGRAM
                    // ==================================================

                    try {

                        const respuesta =
                            await telegramClient.invoke(
                                new Api.messages.GetBotCallbackAnswer(
                                    {
                                        peer:
                                            callback.peer,

                                        msgId:
                                            callback.msgId,

                                        data:
                                            callback.data
                                    }
                                )
                            );

                        /*
                         * Telegram puede devolver un
                         * mensaje corto como respuesta
                         * del callback.
                         */

                        if (
                            respuesta?.message &&
                            global.sock
                        ) {

                            await global.sock.sendMessage(
                                remoteJid,
                                {
                                    text:
                                        `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                        `┊ ${respuesta.message}\n` +
                                        `╰⋯ 》`
                                }
                            );
                        }

                    } catch (error) {

                        console.error(
                            "[TG] ❌ Error ejecutando botón:",
                            error.message
                        );

                        await sock.sendMessage(
                            remoteJid,
                            {
                                text:
                                    `❌ No se pudo ejecutar el botón.\n\n` +
                                    `${error.message}`
                            }
                        );
                    }
                }

            } catch (error) {

                console.error(
                    "[TG] ❌ Error listener WA:",
                    error.message
                );
            }
        }
    );
}

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    try {

        await telegramClient.connect();

        /*
         * MUY IMPORTANTE:
         * primero marcar historial,
         * después instalar NewMessage.
         */

        await marcarHistorial();

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

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
            error.message
        );
    }
}

// ======================================================
// INICIO
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
        "Puente WhatsApp ↔ Telegram con botones",

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

        global.sock =
            sock;

        /*
         * Instalar el listener que detectará
         * los botones tocados en WhatsApp.
         */

        instalarListenerWhatsApp(
            sock
        );

        // ==================================================
        // CHAT
        // ==================================================

        const from =
            msg?.key?.remoteJid;

        if (!from) {
            return;
        }

        /*
         * Este es el ÚLTIMO chat que utilizó /tg.
         */

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

        const mensaje =
            Array.isArray(args)
                ? args.join(" ").trim()
                : String(args || "").trim();

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
        // ENVIAR A TELEGRAM
        // ==================================================

        try {

            const contextInfo =
                msg.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo?.quotedMessage;

            let enviado =
                false;

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
                                    mensaje
                            }
                        );

                        enviado =
                            true;
                    }

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
            // CONFIRMACIÓN
            // ==================================================

            await sock.sendMessage(
                from,
                {
                    text:
                        `📡 *Enviado a @MJnumbers_bot*\n\n` +
                        `${mensaje}`
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
                        error.message
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
