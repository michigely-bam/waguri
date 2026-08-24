import {
    TelegramClient
} from "teleproto";

import {
    StringSession
} from "teleproto/sessions/index.js";

import {
    NewMessage
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
// ESTADO GLOBAL
// ======================================================

if (!global.__TG_BRIDGE_STATE) {

    global.__TG_BRIDGE_STATE = {

        telegramClient: null,

        telegramConectado: false,

        listenerActivo: false,

        telegramUltimoId: 0,

        mensajesProcesados:
            new Set(),

        botones:
            new Map(),

        ultimoDestino:
            null,

        handler:
            null
    };
}

const state =
    global.__TG_BRIDGE_STATE;

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

if (!state.ultimoDestino) {

    state.ultimoDestino =
        cargarDestino();
}

// ======================================================
// CLIENTE TELEGRAM
// ======================================================

if (!state.telegramClient) {

    state.telegramClient =
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
}

const telegramClient =
    state.telegramClient;

// ======================================================
// MARCAR HISTORIAL
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
            mensajes.length > 0
        ) {

            state.telegramUltimoId =
                Number(
                    mensajes[0]?.id || 0
                );

        } else {

            state.telegramUltimoId =
                0;
        }

        // Reiniciar duplicados al conectar.

        state.mensajesProcesados.clear();

    } catch (error) {

        state.telegramUltimoId =
            0;

        console.error(
            "[TG] ⚠️ Error marcando historial:",
            error.message
        );
    }
}

// ======================================================
// CONVERTIR DATA DEL BOTÓN
// ======================================================

function convertirCallbackData(data) {

    if (
        data === undefined ||
        data === null
    ) {

        return null;
    }

    // Buffer

    if (
        Buffer.isBuffer(data)
    ) {

        return data;
    }

    // Uint8Array

    if (
        data instanceof Uint8Array
    ) {

        return Buffer.from(data);
    }

    // Array de bytes

    if (
        Array.isArray(data)
    ) {

        return Buffer.from(data);
    }

    // String

    if (
        typeof data === "string"
    ) {

        return Buffer.from(
            data,
            "utf8"
        );
    }

    // Algunas versiones pueden
    // entregar un objeto con data.

    if (
        data?.data
    ) {

        return convertirCallbackData(
            data.data
        );
    }

    return null;
}

// ======================================================
// EXTRAER BOTONES DE TELEGRAM
// ======================================================

function extraerBotonesTelegram(msg) {

    const resultado =
        [];

    try {

        const rows =
            msg?.replyMarkup?.rows ||
            msg?.replyMarkup?.inlineKeyboard ||
            [];

        for (
            const row of rows
        ) {

            const buttons =
                row?.buttons ||
                row?.inlineKeyboard ||
                [];

            for (
                const button of buttons
            ) {

                const texto =
                    button?.text ||
                    button?.label ||
                    button?.buttonText ||
                    "";

                if (
                    !texto
                ) {

                    continue;
                }

                const callbackRaw =
                    button?.data ||
                    button?.callbackData ||
                    button?.callback_data;

                const callbackData =
                    convertirCallbackData(
                        callbackRaw
                    );

                /*
                 * Solo nos interesan botones
                 * que realmente tengan callback.
                 *
                 * Un botón URL, por ejemplo,
                 * no se puede "pulsar" mediante
                 * getBotCallbackAnswer.
                 */

                if (
                    !callbackData
                ) {

                    continue;
                }

                resultado.push({

                    texto:
                        String(texto),

                    callbackData,

                    telegramMessageId:
                        Number(msg?.id || 0)
                });

                /*
                 * Para esta prueba enviamos
                 * máximo 2 botones.
                 */

                if (
                    resultado.length >= 2
                ) {

                    return resultado;
                }
            }
        }

    } catch (error) {

        console.error(
            "[TG BUTTONS] Error leyendo botones:",
            error.message
        );
    }

    return resultado;
}

// ======================================================
// EXTRAER OPCIONES DEL TEXTO
//
// Solo se usa como respaldo.
//
// IMPORTANTE:
// Estos botones NO tendrán callback_data original.
// Por eso solo se usan cuando Telegram no expone
// correctamente el replyMarkup.
// ======================================================

function extraerOpcionesTexto(texto) {

    const resultado =
        [];

    const lineas =
        String(texto || "")
            .split("\n")
            .map(
                linea =>
                    linea.trim()
            )
            .filter(Boolean);

    for (
        const linea of lineas
    ) {

        const limpia =
            linea
                .replace(
                    /^\s*(?:[-•*]|\d+[.)])\s*/,
                    ""
                )
                .trim();

        if (
            !limpia
        ) {

            continue;
        }

        if (
            limpia.length > 35
        ) {

            continue;
        }

        resultado.push({

            texto:
                limpia,

            /*
             * Fallback:
             * se enviará como texto.
             */

            callbackData:
                Buffer.from(
                    limpia,
                    "utf8"
                ),

            telegramMessageId:
                0,

            fallback:
                true
        });

        if (
            resultado.length >= 2
        ) {

            break;
        }
    }

    return resultado;
}

// ======================================================
// CREAR BOTONES WHATSAPP
// ======================================================

async function enviarRespuestaConBotones(
    destino,
    texto,
    opciones
) {

    if (
        !global.sock
    ) {

        return;
    }

    const botones =
        opciones.slice(0, 2);

    const botonesWA =
        [];

    for (
        let i = 0;
        i < botones.length;
        i++
    ) {

        const boton =
            botones[i];

        const id =
            `tg_btn_${Date.now()}_${i}_${Math.random()
                .toString(36)
                .slice(2, 8)}`;

        /*
         * Guardamos TODO lo necesario
         * para simular el clic real:
         *
         * - callback_data
         * - mensaje de Telegram
         * - destino WA
         */

        state.botones.set(
            id,
            {

                callbackData:
                    boton.callbackData,

                telegramMessageId:
                    boton.telegramMessageId,

                destino,

                texto:
                    boton.texto,

                fallback:
                    Boolean(
                        boton.fallback
                    ),

                creado:
                    Date.now()
            }
        );

        botonesWA.push({

            buttonId:
                id,

            buttonText: {

                displayText:
                    boton.texto
                        .slice(0, 20)

            },

            type: 1
        });
    }

    // ==================================================
    // LIMPIAR BOTONES ANTIGUOS
    // ==================================================

    const ahora =
        Date.now();

    for (
        const [
            id,
            info
        ] of state.botones
    ) {

        if (
            ahora -
            Number(
                info?.creado || 0
            )
            >
            10 * 60 * 1000
        ) {

            state.botones.delete(
                id
            );
        }
    }

    // ==================================================
    // CREAR MENSAJE
    // ==================================================

    try {

        const waMessage =
            generateWAMessageFromContent(
                destino,
                {
                    buttonsMessage: {

                        contentText:
                            texto ||
                            "Selecciona una opción:",

                        footerText:
                            "✦ Telegram ↔ WhatsApp ✦",

                        buttons:
                            botonesWA,

                        headerType:
                            1
                    }
                },
                {}
            );

        await global.sock.relayMessage(
            destino,
            waMessage.message,
            {
                messageId:
                    waMessage.key.id
            }
        );

    } catch (error) {

        console.error(
            "[TG BUTTONS] ❌ Error:",
            error.message
        );

        await global.sock.sendMessage(
            destino,
            {
                text:
                    texto ||
                    "Selecciona una opción."
            }
        );
    }
}

// ======================================================
// ENVIAR TEXTO
// ======================================================

async function enviarTexto(
    destino,
    texto
) {

    if (
        !global.sock ||
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
// MULTIMEDIA
// ======================================================

async function enviarMultimedia(
    destino,
    msg,
    texto
) {

    try {

        const media =
            await telegramClient.downloadMedia(
                msg.media
            );

        if (
            !media
        ) {

            return false;
        }

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

            return true;
        }

        // DOCUMENTO / OTRO

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

        return true;

    } catch (error) {

        console.error(
            "[TG MEDIA] ❌",
            error.message
        );

        return false;
    }
}

// ======================================================
// TELEGRAM → WHATSAPP
// ======================================================

async function procesarTelegram(event) {

    try {

        const msg =
            event?.message;

        if (
            !msg
        ) {

            return;
        }

        // ==================================================
        // IGNORAR MENSAJES PROPIOS
        // ==================================================

        if (
            msg.out
        ) {

            return;
        }

        // ==================================================
        // ID
        // ==================================================

        const messageId =
            Number(
                msg.id || 0
            );

        // ==================================================
        // HISTORIAL
        // ==================================================

        if (
            messageId &&
            messageId <=
            state.telegramUltimoId
        ) {

            return;
        }

        // ==================================================
        // DUPLICADOS
        // ==================================================

        if (
            messageId
        ) {

            if (
                state.mensajesProcesados
                    .has(messageId)
            ) {

                return;
            }

            state.mensajesProcesados.add(
                messageId
            );

            // Limitar memoria.

            if (
                state.mensajesProcesados.size
                >
                500
            ) {

                const ids =
                    [
                        ...state.mensajesProcesados
                    ]
                    .slice(
                        0,
                        250
                    );

                for (
                    const id of ids
                ) {

                    state.mensajesProcesados
                        .delete(id);
                }
            }
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
                sender?.username ||
                ""
            )
            .toLowerCase();

        // ==================================================
        // SOLO @MJNUMBERS_BOT
        // ==================================================

        if (
            username !==
            "mjnumbers_bot"
        ) {

            return;
        }

        // ==================================================
        // SOCKET
        // ==================================================

        if (
            !global.sock
        ) {

            return;
        }

        // ==================================================
        // ÚLTIMO DESTINO
        // ==================================================

        const destino =
            state.ultimoDestino;

        if (
            !destino
        ) {

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
            ).trim();

        // ==================================================
        // BOTONES REALES
        // ==================================================

        let opciones =
            extraerBotonesTelegram(
                msg
            );

        // ==================================================
        // FALLBACK
        // ==================================================

        if (
            opciones.length === 0 &&
            texto
        ) {

            opciones =
                extraerOpcionesTexto(
                    texto
                );
        }

        // ==================================================
        // ENVIAR BOTONES
        // ==================================================

        if (
            opciones.length > 0
        ) {

            await enviarRespuestaConBotones(
                destino,
                texto,
                opciones
            );

            return;
        }

        // ==================================================
        // MULTIMEDIA
        // ==================================================

        if (
            msg.media
        ) {

            const enviado =
                await enviarMultimedia(
                    destino,
                    msg,
                    texto
                );

            if (
                enviado
            ) {

                return;
            }
        }

        // ==================================================
        // TEXTO NORMAL
        // ==================================================

        await enviarTexto(
            destino,
            texto
        );

    } catch (error) {

        console.error(
            "[TG] ❌ Error procesando:",
            error.message
        );
    }
}

// ======================================================
// SIMULAR CLIC REAL EN TELEGRAM
// ======================================================

async function pulsarBotonTelegram(
    boton
) {

    /*
     * Si tenemos callback_data real,
     * usamos messages.getBotCallbackAnswer.
     *
     * Esto es diferente de mandar el texto.
     *
     * Es equivalente a pulsar el botón
     * original del mensaje.
     */

    if (
        !boton ||
        !boton.telegramMessageId
    ) {

        throw new Error(
            "El botón no contiene el mensaje original de Telegram."
        );
    }

    const peer =
        await telegramClient.getInputEntity(
            TELEGRAM_DESTINO
        );

    const data =
        convertirCallbackData(
            boton.callbackData
        );

    if (
        !data
    ) {

        throw new Error(
            "El botón no contiene callback_data."
        );
    }

    const respuesta =
        await telegramClient.api.messages
            .getBotCallbackAnswer(
                {
                    peer,

                    msgId:
                        Number(
                            boton.telegramMessageId
                        ),

                    data
                }
            );

    return respuesta;
}

// ======================================================
// CONECTAR TELEGRAM
// ======================================================

async function iniciarTelegram() {

    if (
        state.listenerActivo
    ) {

        return;
    }

    if (
        !API_ID ||
        !API_HASH ||
        !STRING_SESSION
    ) {

        console.error(
            "[TG] ❌ Faltan variables de Telegram."
        );

        return;
    }

    try {

        await telegramClient.connect();

        // ==================================================
        // PROTEGER HISTORIAL
        // ==================================================

        await marcarHistorial();

        // ==================================================
        // LISTENER
        // ==================================================

        state.handler =
            procesarTelegram;

        telegramClient.addEventHandler(
            state.handler,
            new NewMessage({
                incoming:
                    true
            })
        );

        state.listenerActivo =
            true;

        state.telegramConectado =
            true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Telegram conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            "[TG] 🎯 Escuchando únicamente a @mjnumbers_bot"
        );

        if (
            state.ultimoDestino
        ) {

            console.log(
                `[TG] 📍 Último destino: ${state.ultimoDestino}`
            );
        }

    } catch (error) {

        state.telegramConectado =
            false;

        console.error(
            "[TG] ❌ Error conectando:",
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

    iniciarTelegram();
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
        "Puente Telegram ↔ WhatsApp con botones",

    category:
        "herramientas",

    // ==================================================
    // DETECTOR DE BOTONES WHATSAPP
    // ==================================================

    async before(
        m,
        { conn }
    ) {

        try {

            const from =
                m?.chat ||
                m?.key?.remoteJid;

            if (
                !from
            ) {

                return;
            }

            /*
             * Baileys clásico:
             *
             * buttonsResponseMessage
             *
             * El ID que nosotros generamos
             * está aquí.
             */

            let buttonId =
                m?.message
                    ?.buttonsResponseMessage
                    ?.selectedButtonId;

            /*
             * Algunos loaders desenvuelven
             * el mensaje.
             */

            if (
                !buttonId
            ) {

                buttonId =
                    m?.buttonsResponseMessage
                        ?.selectedButtonId;
            }

            /*
             * Otros loaders colocan el ID
             * directamente.
             */

            if (
                !buttonId
            ) {

                buttonId =
                    m?.selectedButtonId;
            }

            if (
                !buttonId
            ) {

                return;
            }

            buttonId =
                String(
                    buttonId
                );

            // ==================================================
            // SOLO NUESTROS BOTONES
            // ==================================================

            if (
                !buttonId.startsWith(
                    "tg_btn_"
                )
            ) {

                return;
            }

            // ==================================================
            // BUSCAR BOTÓN
            // ==================================================

            const boton =
                state.botones.get(
                    buttonId
                );

            if (
                !boton
            ) {

                await conn.sendMessage(
                    from,
                    {
                        text:
                            "⚠️ Ese botón ya expiró. Usa /tg nuevamente."
                    },
                    {
                        quoted:
                            m
                    }
                );

                return true;
            }

            // ==================================================
            // EVITAR DOBLE CLIC
            // ==================================================

            state.botones.delete(
                buttonId
            );

            // ==================================================
            // ACTUALIZAR DESTINO
            // ==================================================

            state.ultimoDestino =
                from;

            guardarDestino(
                from
            );

            // ==================================================
            // BOTÓN REAL
            // ==================================================

            if (
                !boton.fallback &&
                boton.telegramMessageId
            ) {

                try {

                    await pulsarBotonTelegram(
                        boton
                    );

                    await conn.sendMessage(
                        from,
                        {
                            text:
                                `📡 *Botón pulsado en Telegram*\n\n` +
                                `↳ ${boton.texto}`
                        },
                        {
                            quoted:
                                m
                        }
                    );

                    return true;

                } catch (error) {

                    console.error(
                        "[TG BUTTON] ❌ Callback:",
                        error.message
                    );

                    await conn.sendMessage(
                        from,
                        {
                            text:
                                `❌ No se pudo pulsar el botón en Telegram.\n\n` +
                                `┊ ${error.message}`
                        },
                        {
                            quoted:
                                m
                        }
                    );

                    return true;
                }
            }

            // ==================================================
            // FALLBACK
            //
            // Si no existía callback_data real,
            // mandamos el texto como mensaje.
            // ==================================================

            const fallbackText =
                boton.callbackData
                    ?.toString(
                        "utf8"
                    );

            if (
                fallbackText
            ) {

                await telegramClient.sendMessage(
                    TELEGRAM_DESTINO,
                    {
                        message:
                            fallbackText
                    }
                );
            }

            return true;

        } catch (error) {

            console.error(
                "[TG BUTTON] ❌",
                error.message
            );

            return;
        }
    },

    // ==================================================
    // COMANDO /TG
    // ==================================================

    async execute(
        sock,
        msg,
        { args }
    ) {

        global.sock =
            sock;

        // ==================================================
        // CHAT ACTUAL
        // ==================================================

        const from =
            msg?.chat ||
            msg?.key?.remoteJid;

        if (
            !from
        ) {

            return;
        }

        // ==================================================
        // GUARDAR ÚLTIMO CHAT
        // ==================================================

        state.ultimoDestino =
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

        if (
            !state.telegramConectado
        ) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Telegram todavía no está conectado."
                },
                {
                    quoted:
                        msg
                }
            );
        }

        // ==================================================
        // SIN MENSAJE
        // ==================================================

        if (
            !mensaje
        ) {

            return await sock.sendMessage(
                from,
                {
                    text:
                        "❌ Escribe un mensaje.\n\n" +
                        "Ejemplo:\n" +
                        "/tg /start"
                },
                {
                    quoted:
                        msg
                }
            );
        }

        // ==================================================
        // LIMPIAR BOTONES ANTERIORES
        //
        // Así un botón viejo no puede enviar
        // una acción equivocada.
        // ==================================================

        state.botones.clear();

        // ==================================================
        // ENVIAR A TELEGRAM
        // ==================================================

        try {

            await telegramClient.sendMessage(
                TELEGRAM_DESTINO,
                {
                    message:
                        mensaje
                }
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `📡 *Enviado a @MJnumbers_bot*\n\n` +
                        `${mensaje}`
                },
                {
                    quoted:
                        msg
                }
            );

        } catch (error) {

            console.error(
                "[TG SEND] ❌",
                error.message
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `❌ Error enviando a Telegram:\n${error.message}`
                },
                {
                    quoted:
                        msg
                }
            );
        }
    }
};
