const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// 관리자 비밀번호
const ADMIN_PASSWORD = 'admin1234';

// 데이터 파일 경로
const DATA_FILE = path.join(__dirname, 'posts-data.json');

// 업로드 폴더 생성
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 파일 업로드 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('이미지 또는 동영상 파일만 업로드 가능합니다.'));
    }
  }
});

// 미들웨어
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 채팅 관련 변수
let waitingUsers = [];
let chatRooms = new Map();
let userBlocks = new Map();
let stats = {
  totalConnections: 0,
  activeUsers: 0,
  totalMatches: 0
};

// 게시판 데이터
let posts = [];
let postIdCounter = 1;

// 데이터 로드
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      posts = data.posts || [];
      postIdCounter = data.postIdCounter || 1;
      console.log(`📂 데이터 로드 완료: 게시글 ${posts.length}개`);
    } else {
      console.log('📂 새 데이터 파일 생성');
      saveData();
    }
  } catch (error) {
    console.error('❌ 데이터 로드 실패:', error);
    posts = [];
    postIdCounter = 1;
  }
}

// 데이터 저장
function saveData() {
  try {
    const data = {
      posts: posts,
      postIdCounter: postIdCounter
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ 데이터 저장 실패:', error);
  }
}

loadData();

// ============ 파일 업로드 API ============
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '파일이 없습니다.' });
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    const fileType = req.file.mimetype.startsWith('video') ? 'video' : 'image';
    
    res.json({
      success: true,
      url: fileUrl,
      type: fileType,
      filename: req.file.filename
    });
  } catch (error) {
    console.error('파일 업로드 오류:', error);
    res.status(500).json({ success: false, error: '파일 업로드 실패' });
  }
});

// ============ 게시판 API ============
app.get('/api/posts', (req, res) => {
  try {
    const sortedPosts = [...posts].sort((a, b) => b.createdAt - a.createdAt);
    const safePosts = sortedPosts.map(p => {
      const { password, ...rest } = p;
      return rest;
    });
    res.json(safePosts);
  } catch (error) {
    res.status(500).json({ error: '서버 오류' });
  }
});

app.post('/api/posts', (req, res) => {
  try {
    const { title, content, author, password } = req.body;
    
    if (!title || !content || !author || !password) {
      return res.status(400).json({ success: false, error: '모든 필드를 입력해주세요.' });
    }
    
    if (password.length < 4) {
      return res.status(400).json({ success: false, error: '비밀번호는 4자 이상이어야 합니다.' });
    }
    
    const post = {
      id: postIdCounter++,
      title,
      content,
      author,
      password,
      views: 0,
      likes: 0,
      createdAt: Date.now(),
      comments: []
    };
    
    posts.push(post);
    saveData();
    
    const { password: _, ...safePost } = post;
    res.json({ success: true, post: safePost });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

app.get('/api/posts/:id', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    
    post.views += 1;
    saveData();
    
    const { password, ...safePost } = post;
    res.json(safePost);
  } catch (error) {
    res.status(500).json({ error: '서버 오류' });
  }
});

app.post('/api/posts/:id/comments', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    
    const { content, author, password } = req.body;
    
    if (!content || !author || !password) {
      return res.status(400).json({ success: false, error: '모든 필드를 입력해주세요.' });
    }
    
    if (password.length < 4) {
      return res.status(400).json({ success: false, error: '비밀번호는 4자 이상이어야 합니다.' });
    }
    
    const comment = {
      id: Date.now(),
      author,
      content,
      password,
      createdAt: Date.now()
    };
    
    post.comments.push(comment);
    saveData();
    
    const safePost = {
      ...post,
      comments: post.comments.map(c => {
        const { password: _, ...rest } = c;
        return rest;
      })
    };
    delete safePost.password;
    
    res.json({ success: true, post: safePost });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

app.post('/api/posts/:id/like', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    
    post.likes += 1;
    saveData();
    
    res.json({ success: true, likes: post.likes });
  } catch (error) {
    res.status(500).json({ error: '서버 오류' });
  }
});

app.delete('/api/posts/:id', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { password } = req.body;
    
    const index = posts.findIndex(p => p.id === postId);
    
    if (index === -1) {
      return res.status(404).json({ success: false, error: '게시글을 찾을 수 없습니다.' });
    }
    
    const post = posts[index];
    
    if (password !== ADMIN_PASSWORD && password !== post.password) {
      return res.status(403).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
    }
    
    posts.splice(index, 1);
    saveData();
    
    res.json({ success: true, message: '게시글이 삭제되었습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

app.delete('/api/posts/:postId/comments/:commentId', (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const commentId = parseInt(req.params.commentId);
    const { password } = req.body;
    
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ success: false, error: '게시글을 찾을 수 없습니다.' });
    }
    
    const commentIndex = post.comments.findIndex(c => c.id === commentId);
    
    if (commentIndex === -1) {
      return res.status(404).json({ success: false, error: '댓글을 찾을 수 없습니다.' });
    }
    
    const comment = post.comments[commentIndex];
    
    if (password !== ADMIN_PASSWORD && password !== comment.password) {
      return res.status(403).json({ success: false, error: '비밀번호가 올바르지 않습니다.' });
    }
    
    post.comments.splice(commentIndex, 1);
    saveData();
    
    const safePost = {
      ...post,
      comments: post.comments.map(c => {
        const { password: _, ...rest } = c;
        return rest;
      })
    };
    delete safePost.password;
    
    res.json({ success: true, message: '댓글이 삭제되었습니다.', post: safePost });
  } catch (error) {
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

// ============ 소켓 (채팅) ============
io.on('connection', (socket) => {
  stats.totalConnections++;
  stats.activeUsers++;
  console.log(`새 접속: ${socket.id} (활성: ${stats.activeUsers})`);

  socket.emit('stats', stats);
  io.emit('stats', stats);

  socket.on('find-partner', () => {
    leaveCurrentRoom(socket);

    if (waitingUsers.length > 0) {
      const partner = waitingUsers.shift();
      const roomId = `room-${Date.now()}-${socket.id}`;
      
      socket.join(roomId);
      partner.join(roomId);
      
      chatRooms.set(socket.id, { roomId, partnerId: partner.id });
      chatRooms.set(partner.id, { roomId, partnerId: socket.id });
      
      stats.totalMatches++;
      
      socket.emit('matched', { roomId, partnerId: partner.id });
      partner.emit('matched', { roomId, partnerId: socket.id });
      
      console.log(`매칭: ${socket.id} ↔ ${partner.id}`);
      io.emit('stats', stats);
    } else {
      waitingUsers.push(socket);
      socket.emit('waiting');
    }
  });

  socket.on('message', (data) => {
    const room = chatRooms.get(socket.id);
    if (room && room.roomId) {
      io.to(room.partnerId).emit('message', {
        text: data.text,
        imageUrl: data.imageUrl,
        imageType: data.imageType,
        timestamp: Date.now()
      });
    }
  });

  socket.on('typing', () => {
    const room = chatRooms.get(socket.id);
    if (room && room.partnerId) {
      io.to(room.partnerId).emit('partner-typing');
    }
  });

  socket.on('block-user', (data) => {
    const blockedUserId = data.userId;
    
    if (!userBlocks.has(socket.id)) {
      userBlocks.set(socket.id, new Set());
    }
    userBlocks.get(socket.id).add(blockedUserId);
    
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    stats.activeUsers--;
    
    waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
    
    const room = chatRooms.get(socket.id);
    if (room) {
      io.to(room.partnerId).emit('partner-left');
      chatRooms.delete(room.partnerId);
      chatRooms.delete(socket.id);
    }
    
    userBlocks.delete(socket.id);
    io.emit('stats', stats);
  });
});

function leaveCurrentRoom(socket) {
  const room = chatRooms.get(socket.id);
  if (room) {
    io.to(room.partnerId).emit('partner-left');
    socket.leave(room.roomId);
    chatRooms.delete(room.partnerId);
    chatRooms.delete(socket.id);
  }
  waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
}

const PORT = process.env.PORT || 5000;
http.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════╗
║   🎲 랜덤 채팅 서버 실행 중!      ║
║   포트: ${PORT}                     ║
║   URL: http://localhost:${PORT}    ║
╚════════════════════════════════════╝
  `);
  console.log('✅ 게시판 API 준비 완료');
  console.log(`⚠️  관리자 비밀번호: ${ADMIN_PASSWORD}`);
  console.log(`📂 데이터: ${DATA_FILE}`);
  console.log(`📁 업로드: ${uploadDir}`);
});