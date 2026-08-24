import { TelegramClient, Api } from "teleproto";
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
// ESTADO GLOBAL
// ======================================================

if (!global.__TG_BRIDGE__) {
    global.__TG_BRIDGE__ = {
        client: null,
        conectado: false,
        iniciado: false,
        bot: null,
        botones: new Map()
    };
}

const state = global.__TG_BRIDGE__;

// ======================================================
// VALIDAR
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan credenciales de Telegram en .env"
    );
}

// ======================================================
// CREAR CLIENTE
// ======================================================

if (!state.client && API_ID && API_HASH && STRING_SESSION) {
    state.client = new TelegramClient(
        new StringSession(STRING_SESSION),
        API_ID,
        API_HASH,
        {}
    );
}

// ======================================================
// CONECTAR
// ======================================================

async function iniciarTelegram() {

    if (
        state.iniciado ||
        !state.client ||
        !API_ID ||
        !API_HASH ||
        !STRING_SESSION
    ) {
        return;
    }

    state.iniciado = true;

    try {

        await state.client.connect();

        state.bot =
            await state.client.getEntity(
                TELEGRAM_DESTINO
            );

        state.conectado = true;

        console.log(
            "✅ Telegram conectado → @MJnumbers_bot"
        );

        // ==================================================
        // ESCUCHAR MENSAJES DEL BOT
        // ==================================================

        state.client.addEventHandler(
            async event => {

                try {

                    const message =
                        event.message;

                    if (!message) return;

                    // Ignorar nuestros propios mensajes
                    if (message.out) return;

                    const sender =
                        await message.getSender();

                    if (!sender) return;

                    // Comparar ID directamente
                    if (
                        String(sender.id) !==
                        String(state.bot.id)
                    ) {
                        return;
                    }

                    console.log(
                        "[TG → WA] 📥 Respuesta de @MJnumbers_bot"
                    );

                    await procesarRespuesta(
                        message
                    );

                } catch (error) {

                    console.error(
                        "[TG → WA] ❌ Error:",
                        error.message
                    );
                }
            },
            new NewMessage({})
        );

    } catch (error) {

        state.conectado = false;
        state.iniciado = false;

        console.error(
            "[TG] ❌ Error conectando:",
            error.message
        );
    }
}

// ======================================================
// PROCESAR RESPUESTA
// ======================================================

async function procesarRespuesta(message) {

    if (!global.sock) {
        console.log(
            "[TG → WA] ❌ WhatsApp no está conectado."
        );
        return;
    }

    if (!CHAT_WA_DESTINO) {
        console.log(
            "[TG → WA] ❌ Falta WA_CHAT_DESTINO."
        );
        return;
    }

    const texto =
        String(message.message || "");

    // ==================================================
    // EXTRAER BOTONES
    // ==================================================

    const botones = [];

    const rows =
        message.replyMarkup?.rows || [];

    for (const row of rows) {

        for (const button of row.buttons || []) {

            if (!button?.text) continue;

            let callbackData = null;

            if (button.data) {

                try {

                    callbackData =
                        Buffer.from(
                            button.data
                        );

                } catch {
                    callbackData = null;
                }
            }

            const id =
                `tg_${Date.now()}_${Math.random()
                    .toString(36)
                    .slice(2, 8)}`;

            state.botones.set(
                id,
                {
                    data: callbackData,
                    msgId: message.id,
                    peer: state.bot
                }
            );

            botones.push({
                title:
                    String(button.text)
                        .substring(0, 24),

                rowId: id,

                description:
                    button.url
                        ? "Abrir enlace"
                        : "Seleccionar"
            });
        }
    }

    // ==================================================
    // SIN BOTONES
    // ==================================================

    if (!botones.length) {

        if (!texto.trim()) return;

        await global.sock.sendMessage(
            CHAT_WA_DESTINO,
            {
                text: texto
            }
        );

        console.log(
            "[TG → WA] ✅ Texto enviado."
        );

        return;
    }

    // ==================================================
    // CON BOTONES
    // ==================================================

    try {

        await global.sock.sendMessage(
            CHAT_WA_DESTINO,
            {
                text:
                    texto ||
                    "Selecciona una opción:",

                footer:
                    "📡 @MJnumbers_bot",

                title:
                    "Opciones disponibles",

                buttonText:
                    "Seleccionar",

                sections: [
                    {
                        title:
                            "🌎 Selecciona una opción",

                        rows: botones
                    }
                ]
            }
        );

        console.log(
            `[TG → WA] ✅ Texto + ${botones.length} botones enviados.`
        );

    } catch (error) {

        console.error(
            "[TG → WA] ❌ Error enviando lista:",
            error.message
        );

        // Si la lista falla, al menos mandar el texto
        if (texto.trim()) {

            await global.sock.sendMessage(
                CHAT_WA_DESTINO,
                {
                    text: texto
                }
            );
        }
    }

    // Limpiar después de 15 minutos
    setTimeout(() => {

        for (const boton of botones) {
            state.botones.delete(
                boton.rowId
            );
        }

    }, 15 * 60 * 1000);
}

// ======================================================
// BOTONES WHATSAPP → TELEGRAM
// ======================================================

function instalarHandlerWhatsApp(sock) {

    if (sock.__tgBridgeHandler) {
        return;
    }

    sock.__tgBridgeHandler = true;

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {

            for (const msg of messages) {

                try {

                    if (msg.key?.fromMe) {
                        continue;
                    }

                    const jid =
                        msg.key?.remoteJid;

                    if (!jid) continue;

                    let selectedId = null;

                    // Botón clásico
                    const button =
                        msg.message
                            ?.buttonsResponseMessage;

                    if (button) {

                        selectedId =
                            button.selectedButtonId;
                    }

                    // Lista
                    const list =
                        msg.message
                            ?.listResponseMessage;

                    if (list) {

                        selectedId =
                            list
                                .singleSelectReply
                                ?.selectedRowId;
                    }

                    if (!selectedId) {
                        continue;
                    }

                    const boton =
                        state.botones.get(
                            selectedId
                        );

                    if (!boton) {
                        continue;
                    }

                    console.log(
                        "[WA → TG] 🔘 Botón seleccionado."
                    );

                    // ==================================================
                    // CALLBACK TELEGRAM
                    // ==================================================

                    if (boton.data) {

                        await state.client.invoke(
                            new Api.messages.GetBotCallbackAnswer({
                                peer:
                                    boton.peer,

                                msgId:
                                    boton.msgId,

                                data:
                                    boton.data
                            })
                        );

                        console.log(
                            "[WA → TG] ✅ Selección enviada a Telegram."
                        );
                    }

                    state.botones.delete(
                        selectedId
                    );

                } catch (error) {

                    console.error(
                        "[WA → TG] ❌ Error:",
                        error.message
                    );
                }
            }
        }
    );
}

// ======================================================
// INICIAR
// ======================================================

iniciarTelegram();

// ======================================================
// PLUGIN
// ======================================================

export default {

    name: "bridge",

    alias: [
        "tg",
        "send"
    ],

    command: [
        "tg",
        "send"
    ],

    category:
        "herramientas",

    description:
        "Puente WhatsApp ↔ @MJnumbers_bot",

    // ==================================================
    // EJECUTAR COMANDO
    // ==================================================

    async execute(
        sock,
        msg,
        { args }
    ) {

        global.sock = sock;

        instalarHandlerWhatsApp(sock);

        const from =
            msg.key.remoteJid;

        const mensaje =
            args
                .join(" ")
                .trim();

        // ==================================================
        // TELEGRAM NO CONECTADO
        // ==================================================

        if (!state.conectado) {

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
        // ENVIAR A TELEGRAM
        // ==================================================

        try {

            await state.client.sendMessage(
                state.bot,
                {
                    message: mensaje
                }
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        "📡 *Enviado a @MJnumbers_bot*\n\n" +
                        `> ${mensaje}`
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
                        "❌ *Error enviando a Telegram*\n\n" +
                        error.message
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
