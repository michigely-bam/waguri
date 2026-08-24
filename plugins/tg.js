import {
    TelegramClient,
    Api
} from "teleproto";

import {
    StringSession
} from "teleproto/sessions/index.js";

import {
    NewMessage,
    EditedMessage
} from "teleproto/events/index.js";

import {
    generateWAMessageFromContent
} from "@whiskeysockets/baileys";

import "dotenv/config";

import fs from "fs";
import path from "path";

// ======================================================
// CONFIGURACIÓN
// ======================================================

const API_ID =
    Number(process.env.TELEGRAM_API_ID);

const API_HASH =
    process.env.TELEGRAM_API_HASH;

const STRING_SESSION =
    process.env.TELEGRAM_SESSION;

const TELEGRAM_DESTINO =
    "@MJnumbers_bot";

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
 * Relación entre botón de WhatsApp
 * y botón original de Telegram.
 *
 * tgcb  = callback
 * tgcopy = botón de copiar
 */

const botonesTelegram =
    new Map();

let contadorBotones = 0;

// Evita instalar varias veces
let listenerTelegramInstalado = false;

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve =>
        setTimeout(resolve, ms)
    );

// ======================================================
// DESTINO WHATSAPP
// ======================================================

function cargarDestino() {

    try {

        if (
            !fs.existsSync(
                DESTINO_FILE
            )
        ) {
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
                    actualizado:
                        Date.now()
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

        console.log(
            `[TG] 🛡️ Historial protegido. Último ID: ${telegramUltimoId}`
        );

    } catch (error) {

        telegramUltimoId = 0;

        console.error(
            "[TG] ⚠️ Error marcando historial:",
            error.message
        );
    }
}

// ======================================================
// LIMPIAR BOTONES ANTIGUOS
// ======================================================

function limpiarBotones() {

    if (
        botonesTelegram.size <= 500
    ) {
        return;
    }

    const claves =
        [
            ...botonesTelegram.keys()
        ].slice(
            0,
            250
        );

    for (
        const clave of claves
    ) {

        botonesTelegram.delete(
            clave
        );
    }
}

// ======================================================
// OBTENER COPY TEXT
// ======================================================

function obtenerCopyText(button) {

    if (!button) {
        return "";
    }

    /*
     * Dependiendo de la versión de
     * Teleproto/MTProto puede aparecer
     * en diferentes propiedades.
     */

    const posibles = [

        button.copyText,

        button.copy_text,

        button?.originalArgs?.copyText,

        button?.originalArgs?.copy_text,

        button?.originalArgs?.copy_text?.text

    ];

    for (
        const valor of posibles
    ) {

        if (
            typeof valor === "string" &&
            valor.trim()
        ) {

            return valor;
        }
    }

    return "";
}

// ======================================================
// OBTENER BOTONES TELEGRAM
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

            if (!button) {
                continue;
            }

            const texto =
                String(
                    button.text ||
                    "Opción"
                );

            // ==================================================
            // BOTÓN CALLBACK
            // ==================================================

            if (button.data) {

                const id =
                    `tgcb_${Date.now()}_${++contadorBotones}`;

                botonesTelegram.set(
                    id,
                    {
                        tipo:
                            "callback",

                        peer:
                            TELEGRAM_DESTINO,

                        msgId:
                            Number(msg.id),

                        data:
                            Buffer.from(
                                button.data
                            )
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

                continue;
            }

            // ==================================================
            // BOTÓN COPY
            // ==================================================

            const copyText =
                obtenerCopyText(
                    button
                );

            if (copyText) {

                const id =
                    `tgcopy_${Date.now()}_${++contadorBotones}`;

                botonesTelegram.set(
                    id,
                    {
                        tipo:
                            "copy",

                        peer:
                            TELEGRAM_DESTINO,

                        msgId:
                            Number(msg.id),

                        texto:
                            copyText
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

                continue;
            }

            /*
             * Otros tipos de botones de Telegram
             * que no pueden ejecutarse desde aquí
             * simplemente no se convierten.
             */

            if (
                resultado.length >= 3
            ) {
                break;
            }
        }

        if (
            resultado.length >= 3
        ) {
            break;
        }
    }

    limpiarBotones();

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
        obtenerBotonesTelegram(
            msg
        );

    // ==================================================
    // BOTONES
    // ==================================================

    if (
        botones.length
    ) {

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

async function procesarMensajeTelegram(
    msg
) {

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

    /*
     * Nunca procesar mensajes que
     * ya existían antes del arranque.
     */

    if (
        messageId &&
        messageId <=
        telegramUltimoId
    ) {

        return;
    }

    // ==================================================
    // ANTI-DUPLICADOS
    // ==================================================

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

    // ==================================================
    // IGNORAR MENSAJES PROPIOS
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
        username !==
        "mjnumbers_bot"
    ) {

        return;
    }

    // ==================================================
    // WHATSAPP
    // ==================================================

    if (!global.sock) {
        return;
    }

    const destino =
        global.TG_WA_CHAT ||
        ultimoDestino;

    if (!destino) {

        console.log(
            "[TG] ⚠️ No existe destino de WhatsApp."
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

            // FOTO

            if (
                mediaClass.includes(
                    "Photo"
                )
            ) {

                await global.sock.sendMessage(
                    destino,
                    {
                        image:
                            media,

                        caption:
                            texto ||
                            undefined
                    }
                );

                return;
            }

            // DOCUMENTO / OTROS

            await global.sock.sendMessage(
                destino,
                {
                    document:
                        media,

                    caption:
                        texto ||
                        undefined
                }
            );

            return;

        } catch (error) {

            console.error(
                "[TG] ❌ Error multimedia:",
                error.message
            );

            return;
        }
    }

    // ==================================================
    // TEXTO / BOTONES
    // ==================================================

    await enviarTelegramWhatsApp(
        msg,
        destino
    );
}

// ======================================================
// LISTENER TELEGRAM
// ======================================================

function iniciarListenerTelegram() {

    if (
        listenerTelegramInstalado
    ) {

        return;
    }

    listenerTelegramInstalado =
        true;

    /*
     * MENSAJES NUEVOS
     */

    telegramClient.addEventHandler(

        async event => {

            try {

                await procesarMensajeTelegram(
                    event?.message
                );

            } catch (error) {

                console.error(
                    "[TG] ❌ Error NewMessage:",
                    error.message
                );
            }

        },

        new NewMessage({
            incoming: true
        })
    );

    /*
     * MENSAJES EDITADOS
     *
     * Esto es importante porque un bot
     * puede actualizar sus botones después
     * de ejecutar un callback.
     */

    telegramClient.addEventHandler(

        async event => {

            try {

                const msg =
                    event?.message;

                if (!msg) {
                    return;
                }

                /*
                 * Para una edición NO usamos
                 * el filtro normal de mensajes
                 * procesados, porque es el mismo
                 * mensaje Telegram actualizado.
                 */

                if (msg.out) {
                    return;
                }

                let sender = null;

                try {

                    sender =
                        await msg.getSender();

                } catch {

                    return;
                }

                const username =
                    String(
                        sender?.username ||
                        ""
                    ).toLowerCase();

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

                /*
                 * Una edición puede contener
                 * nuevos botones.
                 */

                if (
                    msg.replyMarkup?.rows?.length
                ) {

                    await enviarTelegramWhatsApp(
                        msg,
                        destino
                    );
                }

            } catch (error) {

                console.error(
                    "[TG] ❌ Error EditedMessage:",
                    error.message
                );
            }

        },

        new EditedMessage({})
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
         *
         * Primero obtenemos el último ID.
         * Después instalamos el listener.
         */

        await marcarHistorial();

        iniciarListenerTelegram();

        telegramConectado =
            true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            "[TG] 🎯 Escuchando únicamente a @mjnumbers_bot"
        );

        if (ultimoDestino) {

            console.log(
                `[TG] 📍 Destino: ${ultimoDestino}`
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
// LISTENER WHATSAPP
// ======================================================

function instalarListenerWhatsApp(
    sock
) {

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
                    const m of messages || []
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
                    // TEMPLATE
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
                    // INTERACTIVE
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
                                // Ignorar
                            }
                        }
                    }

                    if (!buttonId) {
                        continue;
                    }

                    // ==================================================
                    // BUSCAR BOTÓN
                    // ==================================================

                    const callback =
                        botonesTelegram.get(
                            buttonId
                        );

                    if (!callback) {
                        continue;
                    }

                    botonesTelegram.delete(
                        buttonId
                    );

                    console.log(
                        `[TG] 🔘 Botón seleccionado: ${buttonId}`
                    );

                    // ==================================================
                    // BOTÓN COPY
                    // ==================================================

                    if (
                        callback.tipo ===
                        "copy"
                    ) {

                        try {

                            await telegramClient.sendMessage(
                                TELEGRAM_DESTINO,
                                {
                                    message:
                                        callback.texto
                                }
                            );

                            console.log(
                                "[TG] 📋 Copy enviado a Telegram."
                            );

                        } catch (error) {

                            console.error(
                                "[TG] ❌ Error enviando Copy:",
                                error.message
                            );

                            await sock.sendMessage(
                                remoteJid,
                                {
                                    text:
                                        `❌ No se pudo enviar el contenido del botón.\n\n${error.message}`
                                }
                            );
                        }

                        continue;
                    }

                    // ==================================================
                    // CALLBACK
                    // ==================================================

                    if (
                        callback.tipo ===
                        "callback"
                    ) {

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
                             * Algunos callbacks
                             * responden con texto inmediato.
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

                            /*
                             * Damos tiempo a Telegram
                             * para editar el mensaje.
                             */

                            await delay(500);

                            /*
                             * Volvemos a leer el mensaje
                             * original para detectar nuevos
                             * botones/texto.
                             */

                            try {

                                const actualizado =
                                    await telegramClient.getMessages(
                                        TELEGRAM_DESTINO,
                                        {
                                            ids:
                                                callback.msgId
                                        }
                                    );

                                const mensajeActual =
                                    Array.isArray(
                                        actualizado
                                    )
                                        ? actualizado[0]
                                        : actualizado;

                                if (
                                    mensajeActual &&
                                    mensajeActual.replyMarkup?.rows?.length
                                ) {

                                    await enviarTelegramWhatsApp(
                                        mensajeActual,
                                        remoteJid
                                    );
                                }

                            } catch {
                                // El callback ya pudo haber generado EditedMessage.
                            }

                        } catch (error) {

                            console.error(
                                "[TG] ❌ Error ejecutando callback:",
                                error.message
                            );

                            await sock.sendMessage(
                                remoteJid,
                                {
                                    text:
                                        `❌ No se pudo ejecutar el botón.\n\n${error.message}`
                                }
                            );
                        }
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

    name:
        "bridge",

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

        // ==================================================
        // LISTENER BOTONES WHATSAPP
        // ==================================================

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
         * Este será siempre el último
         * chat que utilizó /tg.
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
                : String(
                    args || ""
                ).trim();

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
                        `${error.message}`
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
