var http = require('http'),
    url = require('url'),
    fs = require('fs'),
    sys = require('sys'),
    socketIo = require('socket.io'),
    startOver = ' <a onclick="location.reload()">Start over.</a>';

function makeGame() {
  var board = [[null, null, null], [null, null, null], [null, null, null]],
      expectedMove = 'x',
      moveCount = 0,
      gameOver = false;

  return function(move, x, y) {
    if (gameOver) throw { html: 'Game over.' + startOver };
    if (expectedMove != move) throw { html: 'Not your move!' };
    if (board[x][y]) throw { html: 'Tile is already taken.' };
    board[x][y] = move;
    moveCount++;

    if (board[x].every(function(tile) { return tile == move }) ||
        board.every(function(col) { return col[y] == move }) ||
        board.every(function(col, index) { return col[index] == move }) ||
        board.every(function(col, index) {
          return col[board.length-1-index] == move })) {
      gameOver = true;
      return move + ' has won!' + startOver;
    } else if (moveCount == (Math.pow(board.length, 2) - 1)) {
      gameOver = true;
      return 'Game is a draw.' + startOver;
    }

    expectedMove = move == 'x' ? 'o' : 'x';
    return move + ' took ' + (x+1) + ' by ' + (y+1);
  };
}

function makeGameManager() {
  var players = {},
      openGame = null,
      broadcastClientGame = function(client, msg) {
        players[client.sessionId].game.members.forEach(function(each) {
          each.send(msg);
        });
      };

  return {
    addPlayer: function(client) {
      var move, message, game;
      if (openGame) {
        move = 'x';
        message = 'Game On!';
        game = openGame;
        game.members.push(client);
        openGame = null;
      } else {
        move = 'o';
        message = 'Waiting for opponent.';
        game = openGame = makeGame();
        game.members = [client];
      }
      players[client.sessionId] = { game: game, move: move };
      broadcastClientGame(client, { type: 'message', html: message });
    },

    dropPlayer: function(client) {
      if (openGame && openGame.members[0] == client) {
        openGame = null;
      } else {
        broadcastClientGame(client, {
          type: 'message',
          html: 'Opponent left the game.' + startOver
        });
      }
      delete players[client.sessionId];
    },

    chatHandler: function(client, msg) {
      var text =
        msg.text.replace('&', '&amp;').replace('<', '&lt;').replace('>','&gt;');
      broadcastClientGame(client, {
        type: 'message',
        html: players[client.sessionId].move + ' says: ' + text
      });
    },

    moveHandler: function(client, msg) {
      try {
        var player = players[client.sessionId],
            x = parseInt(msg.tile[5], 10), // format: "tile-XY", ex: "tile-01"
            y = parseInt(msg.tile[6], 10);
        broadcastClientGame(client,
          { type: 'message', html: player.game(player.move, x, y) });
        broadcastClientGame(client,
          { type: 'placeMove', move: player.move, x: x, y: y });
      } catch(e) {
        if (!e.html) throw e;
        client.send(
          { type: 'message', html: '<div class="error">' + e.html + '</div>' });
      }
    }
  };
}

function makeServer() {
  var server = http.createServer(function(req, res) {
    fs.readFile(__dirname + '/client.html', function(err, data) {
      res.writeHead(200, {'Content-Type': 'text/html' });
      if (err) res.end('Error reading client.html');
      else res.end(data, 'utf8');
    });
  });

  var myGameManager = makeGameManager();
  socketIo.listen(server).on('connection', function(client) {
    myGameManager.addPlayer(client);
    client.on('disconnect', function() { myGameManager.dropPlayer(client) });
    client.on('message', function(raw) {
      var msg = JSON.parse(raw),
          handlerName = msg.type + 'Handler';
      if (handlerName in myGameManager) myGameManager[handlerName](client, msg);
      else console.error('Unknown message: ' + raw);
    });
  });

  return server;
}

module.exports = makeServer();
