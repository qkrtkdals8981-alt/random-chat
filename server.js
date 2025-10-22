const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');

// 관리자 비밀번호
const ADMIN_PASSWORD = 'admin1234';

// 데이터 파일 경로
const DATA_FILE = path.join(__dirname, 'posts-data.json');

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

// 게시판 데이터 (파일에서 로드)
let posts = [];
let postIdCounter = 1;

// 데이터 로드 함수
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

// 데이터 저장 함수
function saveData() {
  try {
    const data = {
      posts: posts,
      postIdCounter: postIdCounter
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    console.log('💾 데이터 저장 완료');
  } catch (error) {
    console.error('❌ 데이터 저장 실패:', error);
  }
}

// 서버 시작 시 데이터 로드
loadData();

// ============ 게시판 API ============

// 게시글 목록 조회
app.get('/api/posts', (req, res) => {
  try {
    const sortedPosts = [...posts].sort((a, b) => b.createdAt - a.createdAt);
    // 비밀번호는 제외하고 전송
    const safePosts = sortedPosts.map(p => {
      const { password, ...rest } = p;
      return rest;
    });
    res.json(safePosts);
  } catch (error) {
    console.error('게시글 목록 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 게시글 작성
app.post('/api/posts', (req, res) => {
  try {
    console.log('게시글 작성 요청:', req.body);
    
    const { title, content, author, password } = req.body;
    
    if (!title || !content || !author || !password) {
      return res.status(400).json({ 
        success: false,
        error: '모든 필드를 입력해주세요.' 
      });
    }
    
    if (password.length < 4) {
      return res.status(400).json({ 
        success: false,
        error: '비밀번호는 4자 이상이어야 합니다.' 
      });
    }
    
    if (title.length > 100) {
      return res.status(400).json({ 
        success: false,
        error: '제목은 100자 이하로 입력해주세요.' 
      });
    }
    
    if (content.length > 2000) {
      return res.status(400).json({ 
        success: false,
        error: '내용은 2000자 이하로 입력해주세요.' 
      });
    }
    
    const post = {
      id: postIdCounter++,
      title: title,
      content: content,
      author: author,
      password: password, // 저장하지만 클라이언트에는 안 보냄
      views: 0,
      likes: 0,
      createdAt: Date.now(),
      comments: []
    };
    
    posts.push(post);
    saveData(); // 파일에 저장
    console.log('게시글 작성 완료:', post.id);
    
    const { password: _, ...safePost } = post;
    res.json({ success: true, post: safePost });
  } catch (error) {
    console.error('게시글 작성 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '서버 오류가 발생했습니다.' 
    });
  }
});

// 게시글 상세 조회
app.get('/api/posts/:id', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    
    // 조회수 증가
    post.views += 1;
    saveData();
    
    // 비밀번호 제외하고 전송
    const { password, ...safePost } = post;
    res.json(safePost);
  } catch (error) {
    console.error('게시글 조회 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 댓글 작성
app.post('/api/posts/:id/comments', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    
    const { content, author, password } = req.body;
    
    if (!content || !author || !password) {
      return res.status(400).json({ 
        success: false,
        error: '모든 필드를 입력해주세요.' 
      });
    }
    
    if (password.length < 4) {
      return res.status(400).json({ 
        success: false,
        error: '비밀번호는 4자 이상이어야 합니다.' 
      });
    }
    
    const comment = {
      id: Date.now(),
      author: author,
      content: content,
      password: password,
      createdAt: Date.now()
    };
    
    post.comments.push(comment);
    saveData();
    console.log('댓글 작성 완료:', comment.id);
    
    // 비밀번호 제외하고 전송
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
    console.error('댓글 작성 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '서버 오류가 발생했습니다.' 
    });
  }
});

// 좋아요
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
    console.error('좋아요 오류:', error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// 게시글 삭제 (작성자 비밀번호 또는 관리자 비밀번호)
app.delete('/api/posts/:id', (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const { password } = req.body;
    
    const index = posts.findIndex(p => p.id === postId);
    
    if (index === -1) {
      return res.status(404).json({ 
        success: false,
        error: '게시글을 찾을 수 없습니다.' 
      });
    }
    
    const post = posts[index];
    
    // 관리자 비밀번호 또는 작성자 비밀번호 확인
    if (password !== ADMIN_PASSWORD && password !== post.password) {
      return res.status(403).json({ 
        success: false,
        error: '비밀번호가 올바르지 않습니다.' 
      });
    }
    
    const deletedPost = posts.splice(index, 1)[0];
    saveData();
    console.log('게시글 삭제됨:', deletedPost.id);
    
    res.json({ success: true, message: '게시글이 삭제되었습니다.' });
  } catch (error) {
    console.error('게시글 삭제 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '서버 오류가 발생했습니다.' 
    });
  }
});

// 댓글 삭제 (작성자 비밀번호 또는 관리자 비밀번호)
app.delete('/api/posts/:postId/comments/:commentId', (req, res) => {
  try {
    const postId = parseInt(req.params.postId);
    const commentId = parseInt(req.params.commentId);
    const { password } = req.body;
    
    const post = posts.find(p => p.id === postId);
    
    if (!post) {
      return res.status(404).json({ 
        success: false,
        error: '게시글을 찾을 수 없습니다.' 
      });
    }
    
    const commentIndex = post.comments.findIndex(c => c.id === commentId);
    
    if (commentIndex === -1) {
      return res.status(404).json({ 
        success: false,
        error: '댓글을 찾을 수 없습니다.' 
      });
    }
    
    const comment = post.comments[commentIndex];
    
    // 관리자 비밀번호 또는 작성자 비밀번호 확인
    if (password !== ADMIN_PASSWORD && password !== comment.password) {
      return res.status(403).json({ 
        success: false,
        error: '비밀번호가 올바르지 않습니다.' 
      });
    }
    
    const deletedComment = post.comments.splice(commentIndex, 1)[0];
    saveData();
    console.log('댓글 삭제됨:', deletedComment.id);
    
    // 비밀번호 제외하고 전송
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
    console.error('댓글 삭제 오류:', error);
    res.status(500).json({ 
      success: false,
      error: '서버 오류가 발생했습니다.' 
    });
  }
});

// ============ 소켓 통신 (채팅) ============

io.on('connection', (socket) => {
  stats.totalConnections++;
  stats.activeUsers++;
  console.log(`새 접속: ${socket.id} (활성 사용자: ${stats.activeUsers})`);

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
      
      console.log(`매칭 성공: ${socket.id} ↔ ${partner.id}`);
      io.emit('stats', stats);
    } else {
      waitingUsers.push(socket);
      socket.emit('waiting');
      console.log(`대기 중: ${socket.id}`);
    }
  });

  socket.on('message', (data) => {
    const room = chatRooms.get(socket.id);
    if (room && room.roomId) {
      io.to(room.partnerId).emit('message', {
        text: data.text,
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
    
    console.log(`차단: ${socket.id} blocked ${blockedUserId}`);
    leaveCurrentRoom(socket);
  });

  socket.on('disconnect', () => {
    stats.activeUsers--;
    console.log(`연결 끊김: ${socket.id} (활성 사용자: ${stats.activeUsers})`);
    
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
  console.log('게시판 API 준비 완료!');
  console.log(`⚠️  관리자 비밀번호: ${ADMIN_PASSWORD}`);
  console.log(`📂 데이터 파일: ${DATA_FILE}`);
});