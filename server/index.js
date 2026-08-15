const http = require("http");
const express = require("express");
const { Server } = require("colyseus");
const { ChunkRoom } = require("./rooms/ChunkRoom");

const port = process.env.PORT || 2567;
const app = express();

app.use(express.json());
app.get("/", (req, res) => res.send("Servidor MMO espacial — prototipo fase 0"));

const server = http.createServer(app);
const gameServer = new Server({ server });

// Fase 0: un único chunk fijo, sin sistema de descubrimiento todavía.
gameServer.define("chunk", ChunkRoom);

gameServer.listen(port);
console.log(`Servidor Colyseum escuchando en :${port}`);
