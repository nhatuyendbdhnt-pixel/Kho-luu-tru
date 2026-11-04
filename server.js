const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Phục vụ các file tĩnh từ thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Đột phá tuyến đường trang Admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Chỉ tiêu số người tối đa lọt vào vòng trong qua 8 câu
const MAX_SURVIVORS = [50, 40, 30, 20, 10, 6, 3, 1];

// Quản lý trạng thái trực tiếp trong bộ nhớ RAM
let players = {};             // { socketId: { name: string, isAlive: boolean } }
let currentResponses = {};    // { socketId: { responseTimeMs: number, isCorrect: boolean, answerIndex: number, name: string } }
let currentQuestionIndex = -1; // -1: chưa bắt đầu, 0..7: câu 1 đến câu 8
let questionStartTime = 0;
let isQuestionActive = false;
let questionTimer = null;

// Bộ 8 câu hỏi trắc nghiệm chủ đề Trí tuệ nhân tạo (AI)
const questions = [
  {
    id: 1,
    text: "AI là viết tắt của từ tiếng Anh nào sau đây?",
    options: ["Artificial Intelligence", "Automated Information", "Action Insight", "Active Integration"],
    correct: 0
  },
  {
    id: 2,
    text: "Mô hình ngôn ngữ lớn GPT (Generative Pre-trained Transformer) do tổ chức/công ty nào phát triển?",
    options: ["Google", "OpenAI", "Microsoft", "Meta"],
    correct: 1
  },
  {
    id: 3,
    text: "Phép thử Turing (Turing Test) được thiết kế nhằm mục đích gì?",
    options: ["Đánh giá tốc độ xử lý của máy tính", "Đánh giá khả năng suy nghĩ giống con người của máy tính", "Kiểm tra độ bảo mật mạng máy tính", "Đo dung lượng bộ nhớ RAM"],
    correct: 1
  },
  {
    id: 4,
    text: "Đâu là một kỹ thuật Học máy (Machine Learning) cơ bản?",
    options: ["Học có giám sát (Supervised Learning)", "Lập trình tuyến tính", "Quản lý cơ sở dữ liệu quan hệ", "Biên dịch mã nguồn C++"],
    correct: 0
  },
  {
    id: 5,
    text: "Mạng Nơ-ron Nhân tạo (ANN) được thiết kế dựa trên mô phỏng cơ quan nào?",
    options: ["Trái tim", "Bộ não / Hệ thần kinh con người", "Hệ cơ xương", "Hệ tuần hoàn máu"],
    correct: 1
  },
  {
    id: 6,
    text: "Thị giác máy tính (Computer Vision) trong AI tập trung vào khả năng nào?",
    options: ["Xử lý âm thanh và giọng nói", "Phân tích, hiểu và xử lý hình ảnh/video", "Dịch thuật văn bản tự động", "Chơi các trò chơi cờ vua"],
    correct: 1
  },
  {
    id: 7,
    text: "Đâu là ứng dụng tiêu biểu của AI tạo sinh (Generative AI)?",
    options: ["Tạo văn bản, hình ảnh, âm thanh và mã nguồn mới", "Tự động tính hóa đơn tiền điện", "Lưu trữ tập tin PDF trực tuyến", "Gửi tin nhắn SMS hàng loạt"],
    correct: 0
  },
  {
    id: 8,
    text: "Ai được cộng đồng công nghệ vinh danh là 'Cha đẻ của Trí tuệ nhân tạo' tại Hội nghị Dartmouth 1956?",
    options: ["Alan Turing", "John McCarthy", "Geoffrey Hinton", "Sam Altman"],
    correct: 1
  }
];

function getGameStats() {
  const totalConnected = Object.keys(players).length;
  const alivePlayers = Object.values(players).filter(p => p.isAlive).length;
  const eliminatedPlayers = totalConnected - alivePlayers;

  return {
    totalConnected,
    alivePlayers,
    eliminatedPlayers,
    currentQuestionIndex: currentQuestionIndex >= 0 ? currentQuestionIndex + 1 : 0,
    totalQuestions: questions.length,
    maxSurvivors: currentQuestionIndex >= 0 ? MAX_SURVIVORS[currentQuestionIndex] : MAX_SURVIVORS[0],
    isQuestionActive
  };
}

function broadcastStats() {
  io.emit('stats_update', getGameStats());
}

io.on('connection', (socket) => {
  console.log(`[Connect] Socket kết nối: ${socket.id}`);

  // Người chơi đăng ký tên tham gia
  socket.on('join_game', (playerName) => {
    const cleanName = (playerName || 'Người chơi').trim();
    // Nếu game đã bắt đầu (sau câu 1) thì người chơi mới vào chế độ theo dõi
    const isAlive = (currentQuestionIndex <= 0);

    players[socket.id] = {
      name: cleanName,
      isAlive: isAlive
    };

    socket.emit('joined_success', {
      socketId: socket.id,
      name: cleanName,
      isAlive: isAlive,
      gameStats: getGameStats()
    });

    broadcastStats();
  });

  // Người chơi gửi câu trả lời
  socket.on('submit_answer', (answerIndex) => {
    if (!isQuestionActive) return;
    
    const player = players[socket.id];
    if (!player || !player.isAlive) return;

    // Không cho phép gửi nhiều lần trong 1 câu
    if (currentResponses[socket.id]) return;

    const responseTimeMs = Date.now() - questionStartTime;
    const isCorrect = (answerIndex === questions[currentQuestionIndex].correct);

    currentResponses[socket.id] = {
      socketId: socket.id,
      name: player.name,
      answerIndex: answerIndex,
      responseTimeMs: responseTimeMs,
      isCorrect: isCorrect
    };

    socket.emit('answer_received', {
      responseTimeMs,
      message: 'Đã ghi nhận câu trả lời!'
    });

    io.emit('admin_answer_count', {
      submittedCount: Object.keys(currentResponses).length,
      aliveCount: Object.values(players).filter(p => p.isAlive).length
    });
  });

  // Admin phát câu hỏi tiếp theo
  socket.on('admin_next_question', () => {
    if (currentQuestionIndex + 1 >= questions.length) {
      socket.emit('admin_message', 'Đã hoàn thành tất cả 8 câu hỏi!');
      return;
    }

    currentQuestionIndex++;
    currentResponses = {};
    isQuestionActive = true;
    questionStartTime = Date.now();

    const q = questions[currentQuestionIndex];
    
    io.emit('new_question', {
      questionIndex: currentQuestionIndex + 1,
      totalQuestions: questions.length,
      text: q.text,
      options: q.options,
      timeLimit: 30,
      maxSurvivors: MAX_SURVIVORS[currentQuestionIndex]
    });

    broadcastStats();

    if (questionTimer) clearTimeout(questionTimer);
    questionTimer = setTimeout(() => {
      if (isQuestionActive) {
        processElimination();
      }
    }, 30000);
  });

  // Admin chốt câu hỏi ngay lập tức
  socket.on('admin_force_end_question', () => {
    if (isQuestionActive) {
      if (questionTimer) clearTimeout(questionTimer);
      processElimination();
    }
  });

  // Admin khởi động lại toàn bộ game
  socket.on('admin_reset_game', () => {
    if (questionTimer) clearTimeout(questionTimer);
    currentQuestionIndex = -1;
    currentResponses = {};
    isQuestionActive = false;
    
    Object.keys(players).forEach(id => {
      players[id].isAlive = true;
    });

    io.emit('game_reset');
    broadcastStats();
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    delete currentResponses[socket.id];
    console.log(`[Disconnect] Socket ngắt kết nối: ${socket.id}`);
    broadcastStats();
  });
});

// Hàm lọc và loại người chơi theo quy tắc
function processElimination() {
  isQuestionActive = false;
  if (questionTimer) clearTimeout(questionTimer);

  const maxAllowed = MAX_SURVIVORS[currentQuestionIndex];

  // 1. Lọc các câu trả lời đúng
  const correctResponses = Object.values(currentResponses).filter(r => r.isCorrect);

  // 2. Sắp xếp tăng dần theo mốc thời gian (mili-giây)
  correctResponses.sort((a, b) => a.responseTimeMs - b.responseTimeMs);

  // 3. Lấy ra tối đa N người đúng & nhanh nhất
  const survivors = correctResponses.slice(0, maxAllowed);
  const survivorSet = new Set(survivors.map(r => r.socketId));

  // 4. Cập nhật trạng thái từng người chơi
  Object.keys(players).forEach(socketId => {
    const player = players[socketId];
    if (player.isAlive) {
      if (survivorSet.has(socketId)) {
        player.isAlive = true;
        io.to(socketId).emit('round_result', {
          status: 'survived',
          isFinalWinner: (currentQuestionIndex === questions.length - 1 && survivors.length === 1),
          message: (currentQuestionIndex === questions.length - 1)
            ? '🏆 CHÚC MỪNG BẠN ĐÃ TRỞ THÀNH QUÁN QUÂN AI QUIZ!'
            : `Chúc mừng! Bạn đã giành quyền lọt vào vòng tiếp theo!`,
          correctAnswerIndex: questions[currentQuestionIndex].correct
        });
      } else {
        player.isAlive = false;
        io.to(socketId).emit('round_result', {
          status: 'eliminated',
          message: 'Rất tiếc! Bạn đã bị loại và chuyển sang Chế độ theo dõi.',
          correctAnswerIndex: questions[currentQuestionIndex].correct
        });
      }
    }
  });

  // Báo cáo tổng kết vòng đấu cho Admin
  io.emit('round_ended_summary', {
    questionIndex: currentQuestionIndex + 1,
    correctAnswerIndex: questions[currentQuestionIndex].correct,
    totalAnswered: Object.keys(currentResponses).length,
    correctCount: correctResponses.length,
    survivorCount: survivorSet.size,
    topSurvivors: survivors.map((s, idx) => ({
      rank: idx + 1,
      name: s.name,
      timeSeconds: (s.responseTimeMs / 1000).toFixed(3)
    }))
  });

  broadcastStats();
}

server.listen(PORT, () => {
  console.log(`Server AI Quiz Game đang chạy tại http://localhost:${PORT}`);
});
