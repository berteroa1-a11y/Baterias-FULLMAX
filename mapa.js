
const mapa = L.map("mapaFullmax").setView([-30.7100, -62.0050], 13);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
}).addTo(mapa);

const capaMarcadores = L.layerGroup().addTo(mapa);

const servidoresOverpass = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];

const busqueda = document.getElementById("busqueda");
const listaComercios = document.getElementById("listaComercios");
const estado = document.getElementById("estado");
const contador = document.getElementById("contador");
const zonaActual = document.getElementById("zonaActual");

let buscandoComercios = false;
let ultimaBusqueda = 0;

function mostrarEstado(mensaje) {
    if (estado) estado.textContent = mensaje;
}

function escaparHTML(texto) {
    return String(texto ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caracter]);
}

function obtenerNombre(tags) {
    return tags.name ||
        tags.brand ||
        tags.operator ||
        "Negocio de automotores";
}

function obtenerCoordenadas(elemento) {
    if (elemento.type === "node") {
        return {
            lat: elemento.lat,
            lon: elemento.lon
        };
    }

    if (elemento.center) {
        return {
            lat: elemento.center.lat,
            lon: elemento.center.lon
        };
    }

    return null;
}

function crearConsulta() {
    const limites = mapa.getBounds();

    const sur = limites.getSouth();
    const oeste = limites.getWest();
    const norte = limites.getNorth();
    const este = limites.getEast();

    // Evita búsquedas enormes que suelen provocar timeout.
    if ((norte - sur) > 5 || (este - oeste) > 5) {
        throw new Error(
            "Acercá el mapa a una ciudad o localidad para buscar negocios."
        );
    }

    const caja = `${sur},${oeste},${norte},${este}`;

    return `
        [out:json][timeout:45];
        (
            nwr["shop"="car_parts"](${caja});
            nwr["shop"="car_repair"](${caja});
            nwr["shop"="car"](${caja});
            nwr["craft"="car_repair"](${caja});
            nwr["shop"="tyres"](${caja});
        );
        out center tags;
    `;
}

async function consultarServidor(servidor, consulta) {
    const respuesta = await fetch(servidor, {
        method: "POST",
        headers: {
            "Content-Type":
                "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: "data=" + encodeURIComponent(consulta),
        signal: AbortSignal.timeout(60000)
    });

    if (!respuesta.ok) {
        throw new Error(`HTTP ${respuesta.status}`);
    }

    return await respuesta.json();
}

function mostrarComercios(elementos) {
    capaMarcadores.clearLayers();

    if (listaComercios) {
        listaComercios.innerHTML = "";
    }

    const encontrados = [];

    for (const elemento of elementos) {
        const coordenadas = obtenerCoordenadas(elemento);

        if (!coordenadas ||
            !Number.isFinite(coordenadas.lat) ||
            !Number.isFinite(coordenadas.lon)) {
            continue;
        }

        const tags = elemento.tags || {};
        const nombre = obtenerNombre(tags);
        const direccion = [
            tags["addr:street"],
            tags["addr:housenumber"]
        ].filter(Boolean).join(" ");

        const telefono = tags.phone || tags["contact:phone"];
        const web = tags.website || tags["contact:website"];

        const marcador = L.marker([
            coordenadas.lat,
            coordenadas.lon
        ]);

        let popup = `<strong>${escaparHTML(nombre)}</strong>`;

        if (direccion) {
            popup += `<br>${escaparHTML(direccion)}`;
        }

        if (telefono) {
            popup += `<br>Teléfono: ${escaparHTML(telefono)}`;
        }

        popup += `<br><a href="https://www.google.com/maps/dir/?api=1&destination=${coordenadas.lat},${coordenadas.lon}" target="_blank" rel="noopener noreferrer">Cómo llegar</a>`;

        if (web && /^https?:\/\//i.test(web)) {
            popup += `<br><a href="${escaparHTML(web)}" target="_blank" rel="noopener noreferrer">Sitio web</a>`;
        }

        marcador.bindPopup(popup);
        marcador.addTo(capaMarcadores);

        encontrados.push({
            nombre,
            direccion,
            telefono,
            web,
            lat: coordenadas.lat,
            lon: coordenadas.lon
        });
    }

    if (contador) {
        contador.textContent = encontrados.length;
    }

    if (!listaComercios) return;

    if (encontrados.length === 0) {
        listaComercios.innerHTML =
            "<p>No se encontraron negocios registrados en esta zona. Probá acercarte a otra localidad.</p>";
        return;
    }

    listaComercios.innerHTML = encontrados.map(comercio => {
        const destino =
            `https://www.google.com/maps/dir/?api=1&destination=${comercio.lat},${comercio.lon}`;

        return `
            <article class="comercio">
                <h3>${escaparHTML(comercio.nombre)}</h3>
                ${comercio.direccion
                    ? `<p>${escaparHTML(comercio.direccion)}</p>`
                    : ""}
                ${comercio.telefono
                    ? `<p>Teléfono: ${escaparHTML(comercio.telefono)}</p>`
                    : ""}
                <a href="${destino}" target="_blank" rel="noopener noreferrer">
                    Cómo llegar
                </a>
                ${comercio.web && /^https?:\/\//i.test(comercio.web)
                    ? `<a href="${escaparHTML(comercio.web)}" target="_blank" rel="noopener noreferrer"> Web</a>`
                    : ""}
            </article>
        `;
    }).join("");
}

async function buscarComercios() {
    if (buscandoComercios) return;

    buscandoComercios = true;
    const idBusqueda = ++ultimaBusqueda;

    try {
        const consulta = crearConsulta();

        mostrarEstado("Buscando negocios en la zona…");

        let datos = null;
        let ultimoError = null;

        for (const servidor of servidoresOverpass) {
            try {
                mostrarEstado(
                    `Consultando OpenStreetMap… (${new URL(servidor).hostname})`
                );

                datos = await consultarServidor(servidor, consulta);
                break;
            } catch (error) {
                ultimoError = error;
                console.warn(
                    `Falló el servidor ${servidor}:`,
                    error.message
                );
            }
        }

        if (idBusqueda !== ultimaBusqueda) return;

        if (!datos) {
            throw ultimoError || new Error("No respondió ningún servidor.");
        }

        mostrarComercios(datos.elements || []);
        mostrarEstado(
            `Búsqueda terminada: ${(datos.elements || []).length} resultados recibidos.`
        );

    } catch (error) {
        console.error("Error buscando negocios:", error);

        mostrarEstado(
            error.message ||
            "No se pudo completar la búsqueda. Probá nuevamente."
        );

        if (listaComercios) {
            listaComercios.innerHTML =
                "<p>No se pudo consultar el servicio de mapas. Intentá nuevamente en unos minutos.</p>";
        }

    } finally {
        buscandoComercios = false;
    }
}

async function buscarLugar() {
    const lugar = busqueda?.value.trim();

    if (!lugar) {
        mostrarEstado("Escribí una ciudad o localidad de Argentina.");
        return;
    }

    mostrarEstado("Buscando la localidad…");

    try {
        const url = new URL("https://nominatim.openstreetmap.org/search");
        url.searchParams.set("q", `${lugar}, Argentina`);
        url.searchParams.set("format", "jsonv2");
        url.searchParams.set("limit", "1");
        url.searchParams.set("countrycodes", "ar");

        const respuesta = await fetch(url.toString(), {
            signal: AbortSignal.timeout(20000)
        });

        if (!respuesta.ok) {
            throw new Error(`Error de geolocalización: HTTP ${respuesta.status}`);
        }

        const resultados = await respuesta.json();

        if (!resultados.length) {
            mostrarEstado("No encontramos esa localidad en Argentina.");
            return;
        }

        const lugarEncontrado = resultados[0];

        mapa.setView([
            Number(lugarEncontrado.lat),
            Number(lugarEncontrado.lon)
        ], 14);

        if (zonaActual) {
            zonaActual.textContent = lugarEncontrado.display_name;
        }

        await buscarComercios();

    } catch (error) {
        console.error("Error buscando localidad:", error);
        mostrarEstado(
            "No se pudo localizar esa ciudad. Revisá tu conexión e intentá otra vez."
        );
    }
}

function usarMiUbicacion() {
    if (!navigator.geolocation) {
        mostrarEstado("Tu navegador no permite obtener la ubicación.");
        return;
    }

    mostrarEstado("Obteniendo tu ubicación…");

    navigator.geolocation.getCurrentPosition(
        async posicion => {
            const lat = posicion.coords.latitude;
            const lon = posicion.coords.longitude;

            mapa.setView([lat, lon], 14);

            if (zonaActual) {
                zonaActual.textContent = "Tu ubicación";
            }

            await buscarComercios();
        },
        error => {
            console.error("Error de ubicación:", error);
            mostrarEstado(
                "No se pudo obtener tu ubicación. Permití el acceso en el navegador o buscá una ciudad."
            );
        },
        {
            enableHighAccuracy: false,
            timeout: 15000,
            maximumAge: 60000
        }
    );
}

document.getElementById("buscarLugar")
    ?.addEventListener("click", buscarLugar);

document.getElementById("buscarZona")
    ?.addEventListener("click", buscarComercios);

document.getElementById("miUbicacion")
    ?.addEventListener("click", usarMiUbicacion);

busqueda?.addEventListener("keydown", evento => {
    if (evento.key === "Enter") {
        buscarLugar();
    }
});

mapa.whenReady(() => {
    setTimeout(() => {
        mapa.invalidateSize();
        buscarComercios();
    }, 300);
});

