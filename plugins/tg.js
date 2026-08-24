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
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION"
    );
}

if (!CHAT_WA_DESTINO) {
    console.error(
        "[TG] ❌ Falta WA_CHAT_DESTINO"
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

// ======================================================
// ESTADO GLOBAL
// Evita duplicar listeners cuando el plugin se recarga
// ======================================================

if (!global.__TG_BRIDGE_STATE__) {
    global.__TG_BRIDGE_STATE__ = {
        sock: null,
        listenerInstalado: false,

        // Último mensaje de Telegram que contiene botones
        ultimoTeclado: null,

        // Último chat de WhatsApp que recibió el teclado
        ultimoChatWA: null
    };
}

const bridgeState = global.__TG_BRIDGE_STATE__;

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function conectarTelegram() {
    try {
        if (!API_ID || !API_HASH || !STRING_SESSION) {
            return;
        }

        await telegramClient.connect();

        telegramConectado = true;

        console.log(
            "✅ [TG] Conectado a Telegram"
        );

        console.log(
            "✅ [TG] Puente activo con @MJnumbers_bot"
        );

    } catch (error) {

        telegramConectado = false;

        console.error(
            "[TG] ❌ Error conectando:",
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
// OBTENER BOTONES DE TELEGRAM
// ======================================================

function obtenerBotonesTelegram(msg) {

    const resultado = [];

    try {

        const markup = msg?.replyMarkup;

        if (!markup?.rows) {
            return resultado;
        }

        for (const row of markup.rows) {

            if (!row?.buttons) continue;

            for (const button of row.buttons) {

                if (!button) continue;

                const texto =
                    button.text ||
                    button.label ||
                    "";

                // ------------------------------------------
                // BOTÓN CALLBACK
                // ------------------------------------------

                if (
                    button.className === "KeyboardButtonCallback" ||
                    button.data !== undefined
                ) {

                    let data = button.data;

                    if (typeof data === "string") {
                        data = Buffer.from(data);
                    }

                    resultado.push({
                        text: texto,
                        data,
                        type: "callback"
                    });

                    continue;
                }

                // ------------------------------------------
                // BOTÓN URL
                // ------------------------------------------

                if (
                    button.className === "KeyboardButtonUrl"
                ) {

                    resultado.push({
                        text: texto,
                        url: button.url || "",
                        type: "url"
                    });

                    continue;
                }

                // ------------------------------------------
                // BOTÓN NORMAL
                // ------------------------------------------

                resultado.push({
                    text: texto,
                    type: "text"
                });
            }
        }

    } catch (error) {

        console.error(
            "[TG] Error leyendo botones:",
            error.message
        );
    }

    return resultado;
}

// ======================================================
// ENVIAR TECLADO DE TELEGRAM A WHATSAPP
// ======================================================

async function enviarTecladoWhatsApp(msg) {

    if (!bridgeState.sock) {
        console.log(
            "[TG → WA] ❌ No hay conexión de WhatsApp"
        );
        return;
    }

    if (!CHAT_WA_DESTINO) {
        console.log(
            "[TG → WA] ❌ WA_CHAT_DESTINO no configurado"
        );
        return;
    }

    const botones = obtenerBotonesTelegram(msg);

    if (!botones.length) {
        return false;
    }

    // Guardar el teclado original
    bridgeState.ultimoTeclado = {
        msgId: msg.id,
        peer: msg.peerId,
        botones,
        creado: Date.now()
    };

    bridgeState.ultimoChatWA = CHAT_WA_DESTINO;

    // --------------------------------------------------
    // Separar callbacks de URLs
    // --------------------------------------------------

    const callbacks = botones.filter(
        b => b.type === "callback"
    );

    const urls = botones.filter(
        b => b.type === "url"
    );

    // WhatsApp lista:
    // Cada fila tendrá el texto del botón y un ID interno.
    const rows = botones.map((button, index) => {

        let id;

        if (button.type === "callback") {
            id = `tgcb_${index}`;
        } else if (button.type === "url") {
            id = `tgurl_${index}`;
        } else {
            id = `tgtext_${index}`;
        }

        return {
            title: String(button.text || `Opción ${index + 1}`)
                .substring(0, 24),

            description:
                button.type === "url"
                    ? "Abrir enlace"
                    : "Seleccionar opción",

            rowId: id
        };
    });

    // Guardamos también los IDs generados
    bridgeState.ultimoTeclado.botonesWA = rows.map(
        (row, index) => ({
            rowId: row.rowId,
            index
        })
    );

    const texto =
        msg.message ||
        "Selecciona una opción:";

    // --------------------------------------------------
    // WhatsApp permite agrupar filas en secciones
    // --------------------------------------------------

    const sections = [];

    for (let i = 0; i < rows.length; i += 50) {

        sections.push({
            title:
                sections.length === 0
                    ? "Opciones"
                    : `Opciones ${sections.length + 1}`,

            rows: rows.slice(i, i + 50)
        });
    }

    try {

        await bridgeState.sock.sendMessage(
            CHAT_WA_DESTINO,
            {
                text: texto,

                title:
                    "📡 Respuesta de @MJnumbers_bot",

                buttonText:
                    "🌍 Ver opciones",

                sections,

                footer:
                    "Puente Telegram → WhatsApp"
            }
        );

        console.log(
            `[TG → WA] ${botones.length} botones enviados`
        );

        return true;

    } catch (error) {

        console.error(
            "[TG → WA] ❌ Error enviando lista:",
            error.message
        );

        // Si la lista falla, enviar al menos los nombres
        const textoBotones = botones
            .map(
                (b, i) =>
                    `${i + 1}. ${b.text}`
            )
            .join("\n");

        await bridgeState.sock.sendMessage(
            CHAT_WA_DESTINO,
            {
                text:
                    `${texto}\n\n` +
                    `📋 *Opciones disponibles:*\n\n` +
                    textoBotones
            }
        );

        return false;
    }
}

// ======================================================
// TELEGRAM → WHATSAPP
// RECIBE TODAS LAS RESPUESTAS DEL BOT
// ======================================================

telegramClient.addEventHandler(
    async update => {

        try {

            // ==================================================
            // RESPUESTA NORMAL DE TELEGRAM
            // ==================================================

            if (
                update?.className === "UpdateNewMessage" &&
                update.message
            ) {

                const msg = update.message;

                if (msg.out) {
                    return;
                }

                const sender =
                    await msg.getSender();

                if (!sender) {
                    return;
                }

                const username =
                    sender.username
                        ? sender.username.toLowerCase()
                        : "";

                if (
                    username !==
                    "mjnumbers_bot"
                ) {
                    return;
                }

                if (!bridgeState.sock) {
                    return;
                }

                // ------------------------------------------
                // TEXTO
                // ------------------------------------------

                const texto =
                    msg.message || "";

                // ------------------------------------------
                // SI TIENE BOTONES
                // ------------------------------------------

                const botones =
                    obtenerBotonesTelegram(msg);

                if (botones.length) {

                    await enviarTecladoWhatsApp(msg);

                    return;
                }

                // ------------------------------------------
                // SIN MEDIA
                // ------------------------------------------

                if (!msg.media) {

                    if (!texto.trim()) {
                        return;
                    }

                    await bridgeState.sock.sendMessage(
                        CHAT_WA_DESTINO,
                        {
                            text: texto
                        }
                    );

                    console.log(
                        "[TG → WA] Texto enviado"
                    );

                    return;
                }

                // ------------------------------------------
                // MEDIA
                // ------------------------------------------

                try {

                    const media =
                        await telegramClient.downloadMedia(
                            msg.media
                        );

                    if (!media) {

                        if (texto.trim()) {

                            await bridgeState.sock.sendMessage(
                                CHAT_WA_DESTINO,
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

                        await bridgeState.sock.sendMessage(
                            CHAT_WA_DESTINO,
                            {
                                image: media,
                                caption:
                                    texto || undefined
                            }
                        );

                    }

                    // VIDEO
                    else if (
                        mediaClass.includes("Video")
                    ) {

                        await bridgeState.sock.sendMessage(
                            CHAT_WA_DESTINO,
                            {
                                video: media,
                                caption:
                                    texto || undefined
                            }
                        );

                    }

                    // DOCUMENTO
                    else if (
                        mediaClass.includes("Document")
                    ) {

                        await bridgeState.sock.sendMessage(
                            CHAT_WA_DESTINO,
                            {
                                document: media,
                                caption:
                                    texto || undefined
                            }
                        );

                    }

                    // OTRO
                    else {

                        await bridgeState.sock.sendMessage(
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
                        "[TG → WA] ❌ Media:",
                        mediaError.message
                    );

                    if (texto.trim()) {

                        await bridgeState.sock.sendMessage(
                            CHAT_WA_DESTINO,
                            {
                                text: texto
                            }
                        );
                    }
                }

                return;
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
// EJECUTAR CALLBACK DE TELEGRAM
// ======================================================

async function ejecutarCallbackTelegram(index) {

    const teclado =
        bridgeState.ultimoTeclado;

    if (!teclado) {
        throw new Error(
            "No hay un teclado de Telegram activo."
        );
    }

    if (
        Date.now() - teclado.creado >
        10 * 60 * 1000
    ) {

        bridgeState.ultimoTeclado = null;

        throw new Error(
            "El menú de Telegram expiró. Vuelve a solicitarlo."
        );
    }

    const boton =
        teclado.botones[index];

    if (!boton) {
        throw new Error(
            "Botón no encontrado."
        );
    }

    // ==================================================
    // URL
    // ==================================================

    if (boton.type === "url") {

        return {
            type: "url",
            url: boton.url
        };
    }

    // ==================================================
    // TEXTO
    // ==================================================

    if (boton.type === "text") {

        await telegramClient.sendMessage(
            TELEGRAM_DESTINO,
            {
                message: boton.text
            }
        );

        return {
            type: "text"
        };
    }

    // ==================================================
    // CALLBACK
    // ==================================================

    if (boton.type === "callback") {

        const bot =
            await telegramClient.getEntity(
                TELEGRAM_DESTINO
            );

        const resultado =
            await telegramClient.invoke(
                new Api.messages.GetBotCallbackAnswer({
                    peer: bot,
                    msgId: teclado.msgId,
                    data: boton.data
                })
            );

        console.log(
            "[WA → TG] Callback ejecutado:",
            boton.text
        );

        return {
            type: "callback",
            result: resultado,
            text: boton.text
        };
    }
}

// ======================================================
// LISTENER WHATSAPP
// ======================================================

function instalarListenerWhatsApp(sock) {

    bridgeState.sock = sock;

    if (bridgeState.listenerInstalado) {
        return;
    }

    bridgeState.listenerInstalado = true;

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

            try {

                for (const message of messages) {

                    if (!message?.message) {
                        continue;
                    }

                    const jid =
                        message.key.remoteJid;

                    if (!jid) {
                        continue;
                    }

                    // Solo procesar el chat configurado
                    if (
                        CHAT_WA_DESTINO &&
                        jid !== CHAT_WA_DESTINO
                    ) {
                        continue;
                    }

                    // ==================================================
                    // RESPUESTA DE LISTA
                    // ==================================================

                    const listResponse =
                        message.message
                            ?.listResponseMessage;

                    if (
                        listResponse
                            ?.singleSelectReply
                            ?.selectedRowId
                    ) {

                        const rowId =
                            listResponse
                                .singleSelectReply
                                .selectedRowId;

                        const match =
                            /^tg(cb|url|text)_(\d+)$/
                                .exec(rowId);

                        if (!match) {
                            continue;
                        }

                        const index =
                            Number(match[2]);

                        const boton =
                            bridgeState
                                .ultimoTeclado
                                ?.botones[index];

                        if (!boton) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        "❌ Esta opción ya expiró. Vuelve a solicitar el menú."
                                }
                            );

                            continue;
                        }

                        // ------------------------------------------
                        // URL
                        // ------------------------------------------

                        if (
                            boton.type === "url"
                        ) {

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        `🔗 ${boton.url}`
                                }
                            );

                            continue;
                        }

                        // ------------------------------------------
                        // EJECUTAR TELEGRAM
                        // ------------------------------------------

                        await sock.sendMessage(
                            jid,
                            {
                                text:
                                    `⏳ Seleccionaste: *${boton.text}*`
                            }
                        );

                        try {

                            const resultado =
                                await ejecutarCallbackTelegram(
                                    index
                                );

                            if (
                                resultado?.type ===
                                "text"
                            ) {

                                await sock.sendMessage(
                                    jid,
                                    {
                                        text:
                                            "📡 Opción enviada a Telegram."
                                    }
                                );
                            }

                        } catch (error) {

                            console.error(
                                "[WA → TG] ❌ Callback:",
                                error.message
                            );

                            await sock.sendMessage(
                                jid,
                                {
                                    text:
                                        `❌ Error ejecutando opción:\n${error.message}`
                                }
                            );
                        }
                    }
                }

            } catch (error) {

                console.error(
                    "[WA] ❌ Error procesando botón:",
                    error.message
                );
            }
        }
    );

    console.log(
        "✅ [WA] Listener de botones instalado"
    );
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
        "Puente Telegram ↔ WhatsApp con botones",

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

        // Guardar socket
        bridgeState.sock = sock;

        // Instalar listener
        instalarListenerWhatsApp(sock);

        const from =
            msg.key.remoteJid;

        const mensaje =
            args.join(" ").trim();

        // ==================================================
        // TELEGRAM NO CONECTADO
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
                        ".tg memes"
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
                        `╭⋯ 📡 *ENVIANDO* ⋯》\n` +
                        `┊ [░░░░░░] 0%\n` +
                        `╰⋯ 》`
                },
                {
                    quoted: msg
                }
            );

        try {

            // ==================================================
            // ENVIAR TEXTO A TELEGRAM
            // ==================================================

            await telegramClient.sendMessage(
                TELEGRAM_DESTINO,
                {
                    message: mensaje
                }
            );

            await delay(500);

            // ==================================================
            // FINAL
            // ==================================================

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
                "[TG] ❌ Error:",
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
