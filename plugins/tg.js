:::writing{variant="document" id="58321" title="Plugin tg.js — Puente Telegram → WhatsApp con botones"}
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
// ESTADO GLOBAL
// Evita crear varios clientes/listeners al recargar plugins
// ======================================================

if (!global.__TG_BRIDGE__) {
    global.__TG_BRIDGE__ = {
        client: null,
        conectado: false,
        iniciado: false,
        destinoTelegram: null
    };
}

const state = global.__TG_BRIDGE__;

// ======================================================
// VALIDACIÓN
// ======================================================

if (!API_ID || !API_HASH || !STRING_SESSION) {
    console.error(
        "[TG] ❌ Faltan TELEGRAM_API_ID, TELEGRAM_API_HASH o TELEGRAM_SESSION en .env"
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
// ENVIAR RESPUESTA DE TELEGRAM A WHATSAPP
// ======================================================

async function enviarTelegramAWhatsApp(message) {

    try {

        if (!global.sock) {
            console.log("[TG → WA] ❌ WhatsApp no conectado.");
            return;
        }

        if (!CHAT_WA_DESTINO) {
            console.log("[TG → WA] ❌ Falta WA_CHAT_DESTINO.");
            return;
        }

        const texto = message.message || "";

        // ==================================================
        // OBTENER BOTONES DE TELEGRAM
        // ==================================================

        const botones = [];

        if (message.replyMarkup?.rows) {

            for (const row of message.replyMarkup.rows) {

                if (!row?.buttons) continue;

                for (const button of row.buttons) {

                    const textoBoton =
                        button.text ||
                        button.buttonText ||
                        "Opción";

                    let id = textoBoton;

                    // Callback de Telegram
                    if (button.data) {

                        try {
                            id = Buffer.from(button.data).toString("base64");
                        } catch {
                            id = textoBoton;
                        }
                    }

                    botones.push({
                        title: textoBoton.substring(0, 24),
                        rowId: `tgbtn_${id}`,
                        description: button.url
                            ? "Abrir enlace"
                            : "Seleccionar opción",
                        telegramText: textoBoton,
                        telegramData: button.data
                            ? Buffer.from(button.data).toString("base64")
                            : null
                    });
                }
            }
        }

        // ==================================================
        // DEBUG
        // ==================================================

        console.log("[TG → WA] Mensaje recibido:");
        console.log("Texto:", texto);
        console.log("Botones:", botones.length);

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

            console.log("[TG → WA] ✅ Texto enviado.");
            return;
        }

        // ==================================================
        // CON BOTONES
        //
        // WhatsApp limita los botones clásicos.
        // Por eso usamos LISTA para soportar muchos países.
        // ==================================================

        const rows = botones.map(button => ({
            title: button.title,
            rowId: button.rowId,
            description: button.description
        }));

        await global.sock.sendMessage(
            CHAT_WA_DESTINO,
            {
                text:
                    texto ||
                    "Selecciona una opción:",

                title:
                    "MJ Numbers Bot",

                footer:
                    "Selecciona una opción para continuar.",

                buttonText:
                    "Seleccionar",

                sections: [
                    {
                        title: "Opciones disponibles",
                        rows
                    }
                ]
            }
        );

        // Guardar temporalmente los botones para poder
        // convertir la selección de WhatsApp en callback de Telegram.

        state.botones = botones;

        console.log(
            `[TG → WA] ✅ Mensaje + ${botones.length} opciones enviado.`
        );

    } catch (error) {

        console.error(
            "[TG → WA] ❌ Error:",
            error.message
        );
    }
}

// ======================================================
// INICIAR TELEGRAM
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

        // Resolver el bot UNA sola vez
        state.destinoTelegram =
            await state.client.getEntity(TELEGRAM_DESTINO);

        state.conectado = true;

        console.log(
            "✅ Telegram conectado a @MJnumbers_bot"
        );

        // ==================================================
        // EVENTO CORRECTO DE MENSAJES NUEVOS
        // ==================================================

        state.client.addEventHandler(
            async event => {

                try {

                    const message = event.message;

                    if (!message) return;

                    // Ignorar mensajes enviados por nuestra sesión
                    if (message.out) return;

                    const sender =
                        await message.getSender();

                    if (!sender) return;

                    const senderId =
                        String(sender.id);

                    const botId =
                        String(state.destinoTelegram.id);

                    console.log(
                        `[TG] Mensaje recibido de ID: ${senderId}`
                    );

                    // ==================================================
                    // SOLO @MJnumbers_bot
                    // ==================================================

                    if (senderId !== botId) {

                        console.log(
                            "[TG] Mensaje ignorado: no es @MJnumbers_bot"
                        );

                        return;
                    }

                    console.log(
                        "[TG] ✅ Respuesta de @MJnumbers_bot detectada."
                    );

                    await enviarTelegramAWhatsApp(message);

                } catch (error) {

                    console.error(
                        "[TG] ❌ Error procesando mensaje:",
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

    category: "herramientas",

    description:
        "Puente WhatsApp ↔ @MJnumbers_bot con texto y botones.",

    // ====================================================
    // PROCESAR RESPUESTAS DE BOTONES DE WHATSAPP
    // ====================================================

    async before(msg, { sock }) {

        try {

            if (!state.conectado) return;

            const from =
                msg.key?.remoteJid;

            if (!from) return;

            // Guardar socket
            global.sock = sock;

            // ==================================================
            // BOTÓN CLÁSICO
            // ==================================================

            const buttonResponse =
                msg.message?.buttonsResponseMessage;

            // ==================================================
            // LISTA DE WHATSAPP
            // ==================================================

            const listResponse =
                msg.message?.listResponseMessage;

            let seleccion = null;

            if (buttonResponse) {

                seleccion =
                    buttonResponse.selectedButtonId;

            } else if (listResponse) {

                seleccion =
                    listResponse.singleSelectReply?.selectedRowId;
            }

            if (!seleccion) return;

            console.log(
                "[WA → TG] Opción seleccionada:",
                seleccion
            );

            // ==================================================
            // BUSCAR BOTÓN
            // ==================================================

            const prefijo = "tgbtn_";

            if (!seleccion.startsWith(prefijo)) {
                return;
            }

            const encoded =
                seleccion.substring(prefijo.length);

            const boton =
                state.botones?.find(button => {

                    if (!button.telegramData) {
                        return false;
                    }

                    return (
                        button.telegramData === encoded
                    );
                });

            if (!boton) {

                console.log(
                    "[WA → TG] ❌ No se encontró el botón."
                );

                return;
            }

            // ==================================================
            // ENVIAR CALLBACK A TELEGRAM
            // ==================================================

            if (boton.telegramData) {

                const data =
                    Buffer.from(
                        boton.telegramData,
                        "base64"
                    );

                await state.client.invoke(
                    new state.client.api.messages.GetBotCallbackAnswer({
                        peer: state.destinoTelegram,
                        msgId: 0,
                        data
                    })
                );

                console.log(
                    "[WA → TG] ✅ Callback enviado:",
                    boton.telegramText
                );
            }

        } catch (error) {

            console.error(
                "[WA → TG] ❌ Error botón:",
                error.message
            );
        }
    },

    // ====================================================
    // COMANDO .TG
    // ====================================================

    async execute(sock, msg, { args }) {

        global.sock = sock;

        const from =
            msg.key.remoteJid;

        const mensaje =
            args.join(" ").trim();

        // ==================================================
        // ESTADO
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
        // MENSAJE VACÍO
        // ==================================================

        if (!mensaje) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe algo.\n\n" +
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
                TELEGRAM_DESTINO,
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
                error
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
:::
