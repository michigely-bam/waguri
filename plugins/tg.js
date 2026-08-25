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

// Máximo de botones originales visibles por página.
const BOTONES_POR_PAGINA = 9;

// ======================================================
// ESTADO
// ======================================================

let telegramConectado = false;

let telegramUltimoId = 0;

const mensajesProcesados =
    new Set();

/*
 * ID de WhatsApp -> acción real de Telegram.
 *
 * Ejemplo:
 *
 * tgcb_xxx
 * tgcopy_xxx
 * tgpage_xxx
 */
const botonesTelegram =
    new Map();

/*
 * Guarda todos los botones de cada mensaje
 * de Telegram para poder cambiar de página.
 *
 * msgId -> {
 *   botones: [],
 *   pagina: 0,
 *   destino: "..."
 * }
 */
const paginasTelegram =
    new Map();

let contadorBotones = 0;

// Evita instalar listeners duplicados.
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
// LIMPIAR BOTONES
// ======================================================

function limpiarBotones() {

    if (
        botonesTelegram.size <= 1000 &&
        paginasTelegram.size <= 500
    ) {
        return;
    }

    if (
        botonesTelegram.size > 1000
    ) {

        const claves =
            [
                ...botonesTelegram.keys()
            ].slice(
                0,
                500
            );

        for (
            const clave of claves
        ) {

            botonesTelegram.delete(
                clave
            );
        }
    }

    if (
        paginasTelegram.size > 500
    ) {

        const claves =
            [
                ...paginasTelegram.keys()
            ].slice(
                0,
                250
            );

        for (
            const clave of claves
        ) {

            paginasTelegram.delete(
                clave
            );
        }
    }
}

// ======================================================
// OBTENER COPY TEXT
// ======================================================

function obtenerCopyText(button) {

    if (!button) {
        return "";
    }

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
// CREAR ID DE BOTÓN
// ======================================================

function crearIdBoton(prefijo) {

    return (
        `${prefijo}_` +
        `${Date.now()}_` +
        `${++contadorBotones}_` +
        `${Math.random().toString(36).slice(2, 7)}`
    );
}

// ======================================================
// OBTENER TODOS LOS BOTONES DE TELEGRAM
// ======================================================

function obtenerTodosLosBotonesTelegram(msg) {

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
            // CALLBACK
            // ==================================================

            if (button.data) {

                resultado.push({

                    tipo:
                        "callback",

                    texto,

                    data:
                        Buffer.from(
                            button.data
                        )

                });

                continue;
            }

            // ==================================================
            // COPY
            // ==================================================

            const copyText =
                obtenerCopyText(
                    button
                );

            if (copyText) {

                resultado.push({

                    tipo:
                        "copy",

                    texto,

                    copyText

                });

                continue;
            }

            /*
             * Otros botones de Telegram
             * no se convierten.
             */

        }
    }

    return resultado;
}

// ======================================================
// REGISTRAR BOTÓN CALLBACK
// ======================================================

function registrarCallback(
    msg,
    boton
) {

    const id =
        crearIdBoton(
            "tgcb"
        );

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
                    boton.data
                )
        }
    );

    return {

        buttonId:
            id,

        buttonText: {
            displayText:
                boton.texto
        },

        type: 1

    };
}

// ======================================================
// REGISTRAR COPY
// ======================================================

function registrarCopy(
    msg,
    boton
) {

    const id =
        crearIdBoton(
            "tgcopy"
        );

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
                boton.copyText
        }
    );

    return {

        buttonId:
            id,

        buttonText: {
            displayText:
                boton.texto
        },

        type: 1

    };
}

// ======================================================
// BOTÓN DE PAGINACIÓN
// ======================================================

function registrarPagina(
    msg,
    destino,
    pagina
) {

    const id =
        crearIdBoton(
            "tgpage"
        );

    botonesTelegram.set(
        id,
        {
            tipo:
                "pagina",

            msgId:
                Number(msg.id),

            destino,

            pagina
        }
    );

    return id;
}

// ======================================================
// CONSTRUIR BOTONES DE UNA PÁGINA
// ======================================================

function construirPaginaBotones(
    msg,
    destino,
    botones,
    pagina
) {

    const totalPaginas =
        Math.max(
            1,
            Math.ceil(
                botones.length /
                BOTONES_POR_PAGINA
            )
        );

    const paginaSegura =
        Math.max(
            0,
            Math.min(
                pagina,
                totalPaginas - 1
            )
        );

    const inicio =
        paginaSegura *
        BOTONES_POR_PAGINA;

    const actuales =
        botones.slice(
            inicio,
            inicio +
            BOTONES_POR_PAGINA
        );

    const resultado = [];

    // ==================================================
    // BOTONES ORIGINALES
    // ==================================================

    for (
        const boton of actuales
    ) {

        if (
            boton.tipo ===
            "callback"
        ) {

            resultado.push(
                registrarCallback(
                    msg,
                    boton
                )
            );

            continue;
        }

        if (
            boton.tipo ===
            "copy"
        ) {

            resultado.push(
                registrarCopy(
                    msg,
                    boton
                )
            );
        }
    }

    // ==================================================
    // PAGINACIÓN
    // ==================================================

    if (
        totalPaginas > 1
    ) {

        // Atrás

        if (
            paginaSegura > 0
        ) {

            const idAtras =
                registrarPagina(
                    msg,
                    destino,
                    paginaSegura - 1
                );

            resultado.push({

                buttonId:
                    idAtras,

                buttonText: {
                    displayText:
                        "⬅️ Atrás"
                },

                type: 1

            });
        }

        // Más

        if (
            paginaSegura <
            totalPaginas - 1
        ) {

            const idMas =
                registrarPagina(
                    msg,
                    destino,
                    paginaSegura + 1
                );

            resultado.push({

                buttonId:
                    idMas,

                buttonText: {
                    displayText:
                        "➡️ Más"
                },

                type: 1

            });
        }
    }

    return {
        botones:
            resultado,

        pagina:
            paginaSegura,

        totalPaginas
    };
}

// ======================================================
// ENVIAR PÁGINA A WHATSAPP
// ======================================================

async function enviarPaginaWhatsApp(
    msg,
    destino,
    pagina
) {

    if (
        !global.sock
    ) {
        return;
    }

    const msgId =
        Number(
            msg?.id || 0
        );

    const datos =
        paginasTelegram.get(
            msgId
        );

    if (!datos) {
        return;
    }

    const construida =
        construirPaginaBotones(
            msg,
            destino,
            datos.botones,
            pagina
        );

    datos.pagina =
        construida.pagina;

    datos.destino =
        destino;

    paginasTelegram.set(
        msgId,
        datos
    );

    const texto =
        String(
            msg?.text ||
            msg?.message ||
            ""
        );

    // ==================================================
    // SI NO HAY BOTONES
    // ==================================================

    if (
        !construida.botones.length
    ) {

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

    // ==================================================
    // CREAR MENSAJE WHATSAPP
    // ==================================================

    const contenido =
        generateWAMessageFromContent(
            destino,
            {
                buttonsMessage: {

                    contentText:
                        texto ||
                        "Selecciona una opción",

                    footerText:
                        `✦ Telegram ↔ WhatsApp ✦` +
                        `\nPágina ${construida.pagina + 1}/${construida.totalPaginas}`,

                    buttons:
                        construida.botones,

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

    limpiarBotones();
}

// ======================================================
// ENVIAR TELEGRAM → WHATSAPP
// ======================================================

async function enviarTelegramWhatsApp(
    msg,
    destino
) {

    if (
        !global.sock
    ) {
        return;
    }

    const msgId =
        Number(
            msg?.id || 0
        );

    const texto =
        String(
            msg?.text ||
            msg?.message ||
            ""
        );

    const botones =
        obtenerTodosLosBotonesTelegram(
            msg
        );

    // ==================================================
    // GUARDAR BOTONES
    // ==================================================

    if (
        botones.length
    ) {

        paginasTelegram.set(
            msgId,
            {
                botones,
                pagina: 0,
                destino
            }
        );

        await enviarPaginaWhatsApp(
            msg,
            destino,
            0
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
// PROCESAR MENSAJE TELEGRAM
// ======================================================

async function procesarMensajeTelegram(
    msg
) {

    if (!msg) {
        return;
    }

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

        if (
            mensajesProcesados.size >
            1000
        ) {

            const antiguos =
                [
                    ...mensajesProcesados
                ].slice(
                    0,
                    500
                );

            for (
                const id of antiguos
            ) {

                mensajesProcesados.delete(
                    id
                );
            }
        }
    }

    // ==================================================
    // IGNORAR PROPIOS
    // ==================================================

    if (
        msg.out
    ) {
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

    if (
        !global.sock
    ) {
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

    if (
        msg.media
    ) {

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
                        image:
                            media,

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

    // ==================================================
    // MENSAJES NUEVOS
    // ==================================================

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

    // ==================================================
    // MENSAJES EDITADOS
    // ==================================================

    telegramClient.addEventHandler(

        async event => {

            try {

                const msg =
                    event?.message;

                if (!msg) {
                    return;
                }

                if (
                    msg.out
                ) {
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

                if (
                    !global.sock
                ) {
                    return;
                }

                const destino =
                    global.TG_WA_CHAT ||
                    ultimoDestino;

                if (!destino) {
                    return;
                }

                /*
                 * Si el mensaje editado tiene botones,
                 * reemplazamos las páginas por la nueva
                 * versión.
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

        console.log(
            `[TG] 📑 ${BOTONES_POR_PAGINA} botones por página`
        );

        if (
            ultimoDestino
        ) {

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

                    if (
                        !m?.message
                    ) {
                        continue;
                    }

                    const remoteJid =
                        m.key?.remoteJid;

                    if (
                        !remoteJid
                    ) {
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

                        if (
                            params
                        ) {

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

                    if (
                        !buttonId
                    ) {
                        continue;
                    }

                    // ==================================================
                    // BUSCAR ACCIÓN
                    // ==================================================

                    const accion =
                        botonesTelegram.get(
                            buttonId
                        );

                    if (
                        !accion
                    ) {
                        continue;
                    }

                    console.log(
                        `[TG] 🔘 Botón seleccionado: ${buttonId}`
                    );

                    // ==================================================
                    // PAGINACIÓN
                    // ==================================================

                    if (
                        accion.tipo ===
                        "pagina"
                    ) {

                        /*
                         * No eliminar aquí:
                         * después de mostrar la página
                         * se crean nuevos IDs.
                         */

                        const datos =
                            paginasTelegram.get(
                                accion.msgId
                            );

                        if (
                            !datos
                        ) {
                            continue;
                        }

                        await enviarPaginaWhatsApp(
                            await obtenerMensajeTelegram(
                                accion.msgId
                            ),
                            remoteJid,
                            accion.pagina
                        );

                        continue;
                    }

                    // ==================================================
                    // COPY
                    // ==================================================

                    if (
                        accion.tipo ===
                        "copy"
                    ) {

                        botonesTelegram.delete(
                            buttonId
                        );

                        try {

                            await telegramClient.sendMessage(
                                TELEGRAM_DESTINO,
                                {
                                    message:
                                        accion.texto
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
                        accion.tipo ===
                        "callback"
                    ) {

                        botonesTelegram.delete(
                            buttonId
                        );

                        try {

                            const respuesta =
                                await telegramClient.invoke(
                                    new Api.messages.GetBotCallbackAnswer(
                                        {
                                            peer:
                                                accion.peer,

                                            msgId:
                                                accion.msgId,

                                            data:
                                                accion.data
                                        }
                                    )
                                );

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

                            await delay(500);

                            /*
                             * Volvemos a consultar el mensaje
                             * porque Telegram puede haber cambiado
                             * los botones después del callback.
                             */

                            try {

                                const actualizado =
                                    await obtenerMensajeTelegram(
                                        accion.msgId
                                    );

                                if (
                                    actualizado
                                ) {

                                    if (
                                        actualizado.replyMarkup?.rows?.length
                                    ) {

                                        await enviarTelegramWhatsApp(
                                            actualizado,
                                            remoteJid
                                        );

                                    } else if (
                                        actualizado.text
                                    ) {

                                        await global.sock.sendMessage(
                                            remoteJid,
                                            {
                                                text:
                                                    `╭⋯ 📥 *TELEGRAM* ⋯》\n` +
                                                    `┊ ${actualizado.text}\n` +
                                                    `╰⋯ 》`
                                            }
                                        );
                                    }
                                }

                            } catch (error) {

                                console.error(
                                    "[TG] ⚠️ Error actualizando mensaje:",
                                    error.message
                                );
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

                        continue;
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
// OBTENER MENSAJE TELEGRAM
// ======================================================

async function obtenerMensajeTelegram(
    msgId
) {

    try {

        const actualizado =
            await telegramClient.getMessages(
                TELEGRAM_DESTINO,
                {
                    ids:
                        Number(msgId)
                }
            );

        if (
            Array.isArray(
                actualizado
            )
        ) {

            return actualizado[0] ||
                null;
        }

        return actualizado ||
            null;

    } catch (error) {

        console.error(
            "[TG] ❌ Error leyendo mensaje Telegram:",
            error.message
        );

        return null;
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

    name:
        "bridge",

    alias: [
        "tg",
        "send"
    ],

    description:
        "Puente WhatsApp ↔ Telegram con botones y paginación",

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
        // LISTENER BOTONES
        // ==================================================

        instalarListenerWhatsApp(
            sock
        );

        // ==================================================
        // CHAT
        // ==================================================

        const from =
            msg?.key?.remoteJid;

        if (
            !from
        ) {
            return;
        }

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
            Array.isArray(
                args
            )
                ? args.join(" ").trim()
                : String(
                    args || ""
                ).trim();

        // ==================================================
        // TELEGRAM
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

                    if (
                        media
                    ) {

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

            if (
                !enviado
            ) {

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
                    quoted:
                        msg
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
                    quoted:
                        msg
                }
            );
        }
    }
};
