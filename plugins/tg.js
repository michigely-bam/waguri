import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions/index.js";
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
// ESTADO
// ======================================================

let telegramConectado = false;
let MJ_BOT_ID = null;

// Guarda los botones de Telegram que se muestran en WhatsApp.
//
// jid WhatsApp
//   └── buttonId WhatsApp
//          ├── data Telegram
//          ├── msgId Telegram
//          └── peer Telegram
//
const telegramButtons = new Map();

let whatsappHandlerInstalado = false;

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION."
    );
}

if (!CHAT_WA_DESTINO) {
    console.error(
        "[TG] ❌ Falta WA_CHAT_DESTINO en .env."
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

// ======================================================
// DELAY
// ======================================================

const delay = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ======================================================
// OBTENER ID DEL BOT
// ======================================================

async function prepararBotTelegram() {

    try {

        const bot =
            await telegramClient.getEntity(TELEGRAM_DESTINO);

        MJ_BOT_ID =
            String(bot.id);

        console.log(
            `[TG] ✅ @MJnumbers_bot identificado (${MJ_BOT_ID})`
        );

    } catch (error) {

        MJ_BOT_ID = null;

        console.error(
            "[TG] ❌ No se pudo localizar @MJnumbers_bot:",
            error.message
        );
    }
}

// ======================================================
// EXTRAER BOTONES DE TELEGRAM
// ======================================================

function obtenerBotonesTelegram(msg) {

    const resultado = [];

    const markup =
        msg.replyMarkup;

    if (!markup) {
        return resultado;
    }

    const rows =
        markup.rows || [];

    for (const row of rows) {

        const buttons =
            row.buttons || [];

        for (const button of buttons) {

            if (!button) continue;

            const texto =
                button.text || "";

            if (!texto) continue;

            // ==========================================
            // CALLBACK
            // ==========================================

            if (button.data) {

                let data;

                if (Buffer.isBuffer(button.data)) {

                    data =
                        Buffer.from(button.data);

                } else if (
                    button.data instanceof Uint8Array
                ) {

                    data =
                        Buffer.from(button.data);

                } else {

                    data =
                        Buffer.from(
                            String(button.data)
                        );
                }

                resultado.push({
                    type: "callback",
                    text: texto,
                    data
                });

                continue;
            }

            // ==========================================
            // URL
            // ==========================================

            if (button.url) {

                resultado.push({
                    type: "url",
                    text: texto,
                    url: String(button.url)
                });

                continue;
            }

            // ==========================================
            // OTROS BOTONES
            // ==========================================

            resultado.push({
                type: "text",
                text: texto
            });
        }
    }

    return resultado;
}

// ======================================================
// CREAR ID PARA BOTÓN WHATSAPP
// ======================================================

function crearButtonId() {

    return (
        "tgbtn_" +
        Date.now().toString(36) +
        "_" +
        Math.random()
            .toString(36)
            .slice(2, 8)
    );
}

// ======================================================
// GUARDAR BOTONES
// ======================================================

function guardarBotones(
    jid,
    msg,
    botones
) {

    if (!botones.length) {
        return [];
    }

    const botonesWA = [];

    for (const boton of botones) {

        const id =
            crearButtonId();

        telegramButtons.set(
            `${jid}:${id}`,
            {
                type: boton.type,
                data: boton.data || null,
                url: boton.url || null,
                msgId: msg.id,
                peer: msg.peerId
            }
        );

        botonesWA.push({
            id,
            text: boton.text,
            type: boton.type
        });
    }

    // Limpiar después de 15 minutos
    setTimeout(() => {

        for (const boton of botonesWA) {

            telegramButtons.delete(
                `${jid}:${boton.id}`
            );
        }

    }, 15 * 60 * 1000);

    return botonesWA;
}

// ======================================================
// ENVIAR BOTONES COMO LISTA DE WHATSAPP
// ======================================================

async function enviarBotonesWhatsApp(
    sock,
    jid,
    texto,
    botones
) {

    if (!botones.length) {
        return false;
    }

    const callbacks =
        botones.filter(
            b => b.type === "callback"
        );

    const urls =
        botones.filter(
            b => b.type === "url"
        );

    // ==========================================
    // Si hay callbacks, usamos lista
    // ==========================================

    if (callbacks.length) {

        const botonesGuardados =
            guardarBotones(
                jid,
                ultimoMensajeTelegram,
                callbacks
            );

        const rows =
            botonesGuardados.map(boton => ({
                title: boton.text.slice(0, 24),
                description:
                    "Seleccionar opción",
                id: boton.id
            }));

        try {

            await sock.sendMessage(
                jid,
                {
                    text:
                        texto ||
                        "Selecciona una opción:",
                    footer:
                        "📡 Respuesta de @MJnumbers_bot",
                    buttonText:
                        "Seleccionar",
                    sections: [
                        {
                            title:
                                "Opciones disponibles",
                            rows
                        }
                    ]
                }
            );

            return true;

        } catch (error) {

            console.error(
                "[TG → WA] Error enviando lista:",
                error.message
            );

            // ======================================
            // FALLBACK: botones clásicos
            // ======================================

            try {

                const botonesClasicos =
                    botonesGuardados
                        .slice(0, 3)
                        .map(boton => ({
                            buttonId:
                                boton.id,

                            buttonText: {
                                displayText:
                                    boton.text
                                        .slice(0, 20)
                            },

                            type: 1
                        }));

                await sock.sendMessage(
                    jid,
                    {
                        text:
                            texto ||
                            "Selecciona una opción:",
                        footer:
                            "📡 @MJnumbers_bot",
                        buttons:
                            botonesClasicos,
                        headerType: 1
                    }
                );

                return true;

            } catch (fallbackError) {

                console.error(
                    "[TG → WA] ❌ Fallback también falló:",
                    fallbackError.message
                );
            }
        }
    }

    // ==========================================
    // Si solamente hay URLs
    // ==========================================

    if (urls.length) {

        const urlTexto =
            urls
                .map(
                    b =>
                        `• ${b.text}: ${b.url}`
                )
                .join("\n");

        await sock.sendMessage(
            jid,
            {
                text:
                    `${texto || ""}\n\n${urlTexto}`
                        .trim()
            }
        );

        return true;
    }

    return false;
}

// ======================================================
// ÚLTIMO MENSAJE TELEGRAM
// ======================================================

let ultimoMensajeTelegram = null;

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

telegramClient.addEventHandler(
    async update => {

        try {

            if (!update?.message) {
                return;
            }

            const msg =
                update.message;

            // ==========================================
            // IGNORAR NUESTROS MENSAJES
            // ==========================================

            if (msg.out) {
                return;
            }

            // ==========================================
            // NECESITAMOS EL ID DEL BOT
            // ==========================================

            if (!MJ_BOT_ID) {
                return;
            }

            const sender =
                await msg.getSender();

            if (!sender) {
                return;
            }

            // ==========================================
            // SOLO MJNUMBERS
            // ==========================================

            if (
                String(sender.id) !==
                MJ_BOT_ID
            ) {

                // Silencioso
                return;
            }

            // ==========================================
            // WHATSAPP
            // ==========================================

            if (!global.sock) {
                return;
            }

            if (!CHAT_WA_DESTINO) {
                return;
            }

            // ==========================================
            // GUARDAR MENSAJE TELEGRAM
            // ==========================================

            ultimoMensajeTelegram =
                msg;

            const texto =
                msg.message || "";

            console.log(
                "[TG → WA] 📥 Respuesta de @MJnumbers_bot"
            );

            // ==========================================
            // BOTONES
            // ==========================================

            const botones =
                obtenerBotonesTelegram(msg);

            if (botones.length) {

                const enviado =
                    await enviarBotonesWhatsApp(
                        global.sock,
                        CHAT_WA_DESTINO,
                        texto,
                        botones
                    );

                if (enviado) {

                    console.log(
                        `[TG → WA] 🔘 ${botones.length} botones enviados.`
                    );
                }
            }

            // ==========================================
            // SIN MEDIA
            // ==========================================

            if (!msg.media) {

                // Si solamente tenía botones
                if (botones.length) {
                    return;
                }

                if (!texto.trim()) {
                    return;
                }

                await global.sock.sendMessage(
                    CHAT_WA_DESTINO,
                    {
                        text
                    }
                );

                return;
            }

            // ==========================================
            // MEDIA
            // ==========================================

            try {

                const media =
                    await telegramClient.downloadMedia(
                        msg.media
                    );

                if (!media) {

                    if (texto.trim()) {

                        await global.sock.sendMessage(
                            CHAT_WA_DESTINO,
                            {
                                text
                            }
                        );
                    }

                    return;
                }

                const mediaClass =
                    msg.media.className || "";

                // ======================================
                // FOTO
                // ======================================

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

                }

                // ======================================
                // DOCUMENTO
                // ======================================

                else if (
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

                }

                // ======================================
                // OTRO
                // ======================================

                else {

                    await global.sock.sendMessage(
                        CHAT_WA_DESTINO,
                        {
                            image: media,
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
                        CHAT_WA_DESTINO,
                        {
                            text
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
    }
);

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {

    try {

        await telegramClient.connect();

        telegramConectado = true;

        console.log(
            "✅ Puente WhatsApp → @MJnumbers_bot conectado"
        );

        await prepararBotTelegram();

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando Telegram:",
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
// EXTRAER RESPUESTA DE BOTÓN WHATSAPP
// ======================================================

function obtenerRespuestaBoton(message) {

    if (!message?.message) {
        return null;
    }

    const m =
        message.message;

    // ==========================================
    // BOTÓN CLÁSICO
    // ==========================================

    if (
        m.buttonsResponseMessage
    ) {

        return (
            m.buttonsResponseMessage
                .selectedButtonId ||
            null
        );
    }

    // ==========================================
    // LISTA
    // ==========================================

    if (
        m.listResponseMessage
    ) {

        return (
            m.listResponseMessage
                .singleSelectReply
                ?.selectedRowId ||
            null
        );
    }

    // ==========================================
    // NATIVE FLOW
    // ==========================================

    if (
        m.interactiveResponseMessage
    ) {

        const native =
            m.interactiveResponseMessage
                .nativeFlowResponseMessage;

        if (
            native?.paramsJson
        ) {

            try {

                const params =
                    JSON.parse(
                        native.paramsJson
                    );

                return (
                    params.id ||
                    params.selected_id ||
                    null
                );

            } catch {
                return null;
            }
        }
    }

    return null;
}

// ======================================================
// INSTALAR HANDLER DE BOTONES WHATSAPP
// ======================================================

function instalarHandlerWhatsApp(sock) {

    if (whatsappHandlerInstalado) {
        return;
    }

    whatsappHandlerInstalado = true;

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

            try {

                for (const message of messages) {

                    if (!message?.message) {
                        continue;
                    }

                    // ==================================
                    // IGNORAR MENSAJES PROPIOS
                    // ==================================

                    if (
                        message.key?.fromMe
                    ) {
                        continue;
                    }

                    const jid =
                        message.key?.remoteJid;

                    if (!jid) {
                        continue;
                    }

                    // ==================================
                    // OBTENER ID DEL BOTÓN
                    // ==================================

                    const buttonId =
                        obtenerRespuestaBoton(
                            message
                        );

                    if (!buttonId) {
                        continue;
                    }

                    const registro =
                        telegramButtons.get(
                            `${jid}:${buttonId}`
                        );

                    if (!registro) {

                        console.log(
                            "[WA → TG] Botón desconocido:",
                            buttonId
                        );

                        continue;
                    }

                    // ==================================
                    // URL
                    // ==================================

                    if (
                        registro.type === "url"
                    ) {

                        await sock.sendMessage(
                            jid,
                            {
                                text:
                                    `🔗 ${registro.url}`
                            },
                            {
                                quoted:
                                    message
                            }
                        );

                        continue;
                    }

                    // ==================================
                    // CALLBACK TELEGRAM
                    // ==================================

                    if (
                        registro.type !==
                        "callback"
                    ) {

                        continue;
                    }

                    if (
                        !registro.data ||
                        !registro.msgId ||
                        !registro.peer
                    ) {

                        continue;
                    }

                    console.log(
                        "[WA → TG] 🔘 Pulsado:",
                        buttonId
                    );

                    // ==================================
                    // PRESIONAR BOTÓN EN TELEGRAM
                    // ==================================

                    const respuesta =
                        await telegramClient.invoke(
                            new Api.messages.GetBotCallbackAnswer({
                                peer:
                                    registro.peer,

                                msgId:
                                    registro.msgId,

                                data:
                                    registro.data
                            })
                        );

                    console.log(
                        "[WA → TG] ✅ Callback enviado."
                    );

                    // ==================================
                    // ALGUNOS BOTS DEVUELVEN
                    // UNA RESPUESTA DIRECTA
                    // ==================================

                    if (
                        respuesta?.message
                    ) {

                        await sock.sendMessage(
                            jid,
                            {
                                text:
                                    String(
                                        respuesta.message
                                    )
                            },
                            {
                                quoted:
                                    message
                            }
                        );
                    }

                }

            } catch (error) {

                console.error(
                    "[WA → TG] ❌ Error botón:",
                    error.message
                );
            }
        }
    );
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

    command: [
        "tg",
        "send"
    ],

    description:
        "Puente WhatsApp ↔ @MJnumbers_bot",

    category:
        "herramientas",

    async execute(
        sock,
        msg,
        { args }
    ) {

        // ==========================================
        // GUARDAR SOCKET
        // ==========================================

        global.sock =
            sock;

        // ==========================================
        // INSTALAR RESPUESTAS DE BOTONES
        // ==========================================

        instalarHandlerWhatsApp(
            sock
        );

        const from =
            msg.key.remoteJid;

        const senderName =
            msg.pushName ||
            "Usuario";

        const mensaje =
            args
                .join(" ")
                .trim();

        // ==========================================
        // TELEGRAM
        // ==========================================

        if (!telegramConectado) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ El puente de Telegram todavía no está conectado."
                },
                {
                    quoted:
                        msg
                }
            );
        }

        // ==========================================
        // DESTINO WA
        // ==========================================

        if (!CHAT_WA_DESTINO) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Falta WA_CHAT_DESTINO en .env."
                },
                {
                    quoted:
                        msg
                }
            );
        }

        // ==========================================
        // MENSAJE
        // ==========================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        ".tg memes"
                },
                {
                    quoted:
                        msg
                }
            );
        }

        // ==========================================
        // PROGRESO
        // ==========================================

        const { key } =
            await sock.sendMessage(
                from,
                {
                    text:
                        `╭⋯ 📡 *ENVIANDO* ⋯》\n` +
                        `┊ [░░░░░░] 0%\n` +
                        `╰⋯ 》`
                },
                {
                    quoted:
                        msg
                }
            );

        try {

            let enviado =
                false;

            // ======================================
            // MENSAJE CITADO
            // ======================================

            const contextInfo =
                msg.message
                    ?.extendedTextMessage
                    ?.contextInfo;

            const quoted =
                contextInfo
                    ?.quotedMessage;

            // ======================================
            // IMAGEN CITADA
            // ======================================

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

                    enviado =
                        true;

                } catch (error) {

                    console.error(
                        "[TG] ❌ Error imagen:",
                        error.message
                    );
                }
            }

            // ======================================
            // TEXTO
            // ======================================

            if (!enviado) {

                await telegramClient.sendMessage(
                    TELEGRAM_DESTINO,
                    {
                        message:
                            mensaje
                    }
                );
            }

            // ======================================
            // PROGRESO FINAL
            // ======================================

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
                    quoted:
                        msg
                }
            );
        }
    }
};
