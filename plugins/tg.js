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
//
// IMPORTANTE:
//
// Lo guardamos en global para que al recargar el plugin
// NO se cree otro listener de Telegram.
//
// Esto evita:
// respuesta → 2 mensajes
// respuesta → 3 mensajes
// respuesta → 4 mensajes
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

            state.telegramUltimoId =
                Number(
                    mensajes[0]?.id || 0
                );

        } else {

            state.telegramUltimoId = 0;
        }

    } catch (error) {

        state.telegramUltimoId = 0;

        console.error(
            "[TG] Error marcando historial:",
            error.message
        );
    }
}

// ======================================================
// EXTRAER BOTONES DE TELEGRAM
//
// teleproto normalmente expone los botones mediante:
//
// msg.replyMarkup.rows
//
// Cada fila contiene buttons.
//
// Intentamos varias propiedades para hacerlo compatible
// con diferentes versiones.
// ======================================================

function extraerBotonesTelegram(msg) {

    const resultado = [];

    try {

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

                const texto =
                    button?.text ||
                    button?.label ||
                    button?.buttonText ||
                    "";

                if (!texto) {
                    continue;
                }

                let accion =
                    button?.data ||
                    button?.callbackData ||
                    button?.value ||
                    texto;

                if (
                    Buffer.isBuffer(accion)
                ) {

                    accion =
                        accion.toString();
                }

                resultado.push({

                    texto:
                        String(texto),

                    accion:
                        String(accion)

                });

                // Solo necesitamos 2 para la prueba.
                if (
                    resultado.length >= 2
                ) {

                    return resultado;
                }
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
// FALLBACK
//
// Si teleproto no entrega replyMarkup, intentamos sacar
// opciones simples del texto.
//
// Ejemplo:
//
// 1. Opción A
// 2. Opción B
//
// o:
//
// Opción A
// Opción B
// ======================================================

function extraerOpcionesTexto(texto) {

    const lineas =
        String(texto || "")
            .split("\n")
            .map(x => x.trim())
            .filter(Boolean);

    const opciones = [];

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

        if (!limpia) {
            continue;
        }

        // Evitamos convertir textos demasiado largos
        // en botones.

        if (
            limpia.length > 35
        ) {
            continue;
        }

        opciones.push({

            texto:
                limpia,

            accion:
                limpia

        });

        if (
            opciones.length >= 2
        ) {

            break;
        }
    }

    return opciones;
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

    // ==================================================
    // GUARDAR ACCIONES
    // ==================================================

    const botonesWA = [];

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
                .slice(2, 7)}`;

        state.botones.set(
            id,
            {
                accion:
                    boton.accion,

                destino,

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
    // LIMPIAR BOTONES VIEJOS
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
            Number(info?.creado || 0)
            >
            10 * 60 * 1000
        ) {

            state.botones.delete(id);
        }
    }

    // ==================================================
    // MENSAJE CON BOTONES
    // ==================================================

    try {

        const msg =
            generateWAMessageFromContent(
                destino,
                {
                    buttonsMessage: {

                        contentText:
                            texto,

                        footerText:
                            "✦ Telegram ↔ WhatsApp ✦",

                        buttons:
                            botonesWA,

                        headerType: 1

                    }
                },
                {}
            );

        await global.sock.relayMessage(
            destino,
            msg.message,
            {
                messageId:
                    msg.key.id
            }
        );

    } catch (error) {

        console.error(
            "[TG BUTTONS] Error:",
            error.message
        );

        // Si los botones fallan,
        // mandamos el texto normal.

        await global.sock.sendMessage(
            destino,
            {
                text:
                    texto
            }
        );
    }
}

// ======================================================
// ENVIAR RESPUESTA NORMAL
// ======================================================

async function enviarTexto(
    destino,
    texto
) {

    if (
        !texto ||
        !texto.trim() ||
        !global.sock
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
        // MENSAJES PROPIOS
        // ==================================================

        if (msg.out) {
            return;
        }

        // ==================================================
        // ID
        // ==================================================

        const messageId =
            Number(msg.id || 0);

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

        if (messageId) {

            if (
                state.mensajesProcesados
                    .has(messageId)
            ) {

                return;
            }

            state.mensajesProcesados.add(
                messageId
            );
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
            )
            .toLowerCase();

        // ==================================================
        // SOLO MJNUMBERS
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
        // DESTINO
        // ==================================================

        const destino =
            state.ultimoDestino;

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
            ).trim();

        // ==================================================
        // BOTONES DE TELEGRAM
        // ==================================================

        let opciones =
            extraerBotonesTelegram(msg);

        // ==================================================
        // FALLBACK POR TEXTO
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
        // SI HAY BOTONES
        // ==================================================

        if (
            opciones.length > 0
        ) {

            await enviarRespuestaConBotones(
                destino,
                texto ||
                    "Selecciona una opción:",
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

            try {

                const media =
                    await telegramClient
                        .downloadMedia(
                            msg.media
                        );

                if (
                    media
                ) {

                    const mediaClass =
                        String(
                            msg.media
                                ?.className ||
                            ""
                        );

                    // FOTO

                    if (
                        mediaClass.includes(
                            "Photo"
                        )
                    ) {

                        await global.sock
                            .sendMessage(
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

                    // DOCUMENTO

                    await global.sock
                        .sendMessage(
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
                }

            } catch (error) {

                console.error(
                    "[TG MEDIA]",
                    error.message
                );
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
            "[TG] Error procesando:",
            error.message
        );
    }
}

// ======================================================
// LISTENER
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
        // MARCAR HISTORIAL ANTES DEL LISTENER
        // ==================================================

        await marcarHistorial();

        // ==================================================
        // SOLO UN LISTENER
        // ==================================================

        if (
            !state.listenerActivo
        ) {

            state.handler =
                procesarTelegram;

            telegramClient.addEventHandler(
                state.handler,
                new NewMessage({
                    incoming: true
                })
            );

            state.listenerActivo =
                true;
        }

        state.telegramConectado =
            true;

        const me =
            await telegramClient.getMe();

        console.log(
            `[TG] ✅ Conectado como @${me?.username || me?.firstName || "usuario"}`
        );

        console.log(
            "[TG] 🎯 Escuchando únicamente a @mjnumbers_bot"
        );

    } catch (error) {

        state.telegramConectado =
            false;

        console.error(
            "[TG] ❌ Error:",
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
    // BOTONES DE WHATSAPP
    // ==================================================

    async before(
        m,
        { conn }
    ) {

        try {

            const from =
                m?.chat ||
                m?.key?.remoteJid;

            if (!from) {
                return;
            }

            // ==================================================
            // DETECTAR BOTÓN
            // ==================================================

            const buttonId =
                m?.buttonId ||
                m?.selectedButtonId ||
                m?.message
                    ?.buttonsResponseMessage
                    ?.selectedButtonId ||
                m?.message
                    ?.templateButtonReplyMessage
                    ?.selectedId ||
                m?.message
                    ?.interactiveResponseMessage
                    ?.nativeFlowResponseMessage
                    ?.paramsJson;

            if (
                !buttonId
            ) {

                return;
            }

            let id =
                String(
                    buttonId
                );

            // nativeFlow puede devolver JSON
            try {

                const parsed =
                    JSON.parse(id);

                if (
                    parsed?.id
                ) {

                    id =
                        parsed.id;
                }

            } catch {}

            // ==================================================
            // SOLO NUESTROS BOTONES
            // ==================================================

            if (
                !id.startsWith(
                    "tg_btn_"
                )
            ) {

                return;
            }

            const boton =
                state.botones.get(id);

            if (!boton) {

                await conn.sendMessage(
                    from,
                    {
                        text:
                            "⚠️ Ese botón ya expiró. Usa /tg nuevamente."
                    },
                    {
                        quoted: m
                    }
                );

                return;
            }

            // ==================================================
            // DESTINO ACTUAL
            // ==================================================

            const destino =
                state.ultimoDestino ||
                boton.destino;

            if (
                !destino
            ) {

                return;
            }

            // ==================================================
            // ACCIÓN
            // ==================================================

            const accion =
                String(
                    boton.accion || ""
                );

            if (
                !accion.trim()
            ) {

                return;
            }

            // ==================================================
            // ELIMINAR PARA EVITAR DOBLE CLIC
            // ==================================================

            state.botones.delete(
                id
            );

            // ==================================================
            // ENVIAR ACCIÓN A TELEGRAM
            // ==================================================

            await telegramClient.sendMessage(
                TELEGRAM_DESTINO,
                {
                    message:
                        accion
                }
            );

            // ==================================================
            // AVISO
            // ==================================================

            await conn.sendMessage(
                from,
                {
                    text:
                        `📡 *Enviado a Telegram:*\n` +
                        `${accion}`
                },
                {
                    quoted: m
                }
            );

            return true;

        } catch (error) {

            console.error(
                "[TG BUTTON]",
                error.message
            );

            return;
        }
    },

    // ==================================================
    // /TG
    // ==================================================

    async execute(
        sock,
        msg,
        { args }
    ) {

        global.sock =
            sock;

        const from =
            msg?.chat ||
            msg?.key?.remoteJid;

        if (!from) {
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

        const mensaje =
            Array.isArray(args)
                ? args.join(" ").trim()
                : String(args || "").trim();

        // ==================================================
        // TELEGRAM
        // ==================================================

        if (
            !state.telegramConectado
        ) {

            return sock.sendMessage(
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

        if (
            !mensaje
        ) {

            return sock.sendMessage(
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
                    quoted: msg
                }
            );

        } catch (error) {

            console.error(
                "[TG SEND]",
                error.message
            );

            await sock.sendMessage(
                from,
                {
                    text:
                        `❌ Error enviando a Telegram:\n${error.message}`
                },
                {
                    quoted: msg
                }
            );
        }
    }
};
