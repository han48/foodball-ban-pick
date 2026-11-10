import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faClock,
  faFutbol,
  faLightbulb,
  faLink,
  faListCheck,
  faMagnifyingGlass,
  faPlus,
  faRotateLeft,
  faStar,
  faUpload,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

const DEMO_PLAYERS = [
  ["Nguyễn Hoàng Đức", "MF", 8], ["Nguyễn Quang Hải", "MF", 19],
  ["Đoàn Văn Hậu", "DF", 5], ["Nguyễn Tiến Linh", "FW", 22],
  ["Bùi Tiến Dũng", "GK", 1], ["Phạm Tuấn Hải", "FW", 10],
  ["Đỗ Hùng Dũng", "MF", 16], ["Quế Ngọc Hải", "DF", 3],
  ["Nguyễn Văn Toàn", "FW", 9], ["Nguyễn Thanh Bình", "DF", 6],
  ["Lương Xuân Trường", "MF", 7], ["Đặng Văn Lâm", "GK", 23],
  ["Hồ Tấn Tài", "DF", 4], ["Nguyễn Hai Long", "MF", 14],
  ["Vũ Văn Thanh", "DF", 17], ["Nguyễn Văn Quyết", "FW", 10],
].map(([name, position, number], index) => ({ id: `demo-${index}`, name, position, number, country: "VN" }));

const INITIAL_GAME = {
  players: DEMO_PLAYERS,
  teams: [
    { name: "Đội vàng", color: "#f5c84b", players: [] },
    { name: "Đội đỏ", color: "#f0645b", players: [] },
  ],
  captains: ["Đội trưởng 1", "Đội trưởng 2"],
  currentTeam: 0,
  pickCount: 0,
  turnPicks: 0,
  history: [],
};

function playerId(player) {
  return player.id || `${player.name}-${player.number}`;
}

const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SIGNALING_BASE_URL = import.meta.env.VITE_SIGNALING_BASE_URL || "/api/office-game/signal";
const PARTICIPANT_NAME_STORAGE_KEY = "football-draft-participant-name";
const PEER_CONNECTION_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

function getSavedParticipantName() {
  try {
    return window.localStorage.getItem(PARTICIPANT_NAME_STORAGE_KEY) || "";
  } catch (error) {
    console.warn("Could not read the saved participant name.", error);
    return "";
  }
}

function createRoomId() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(randomBytes, (byte) => ROOM_CODE_CHARACTERS[byte & 31]).join("");
}

function normalizeRoomId(value) {
  const roomId = value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(roomId)) throw new Error("Mã phòng cần có 8 ký tự.");
  return roomId;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV cần có dòng tiêu đề và ít nhất một cầu thủ.");

  const normalize = (value) => value.toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const headers = rows[0].map(normalize);
  const findColumn = (names) => headers.findIndex((header) => names.some((name) => header.includes(name)));
  const nameCol = findColumn(["name", "ten", "player", "cau thu"]);
  const positionCol = findColumn(["position", "vi tri", "pos"]);
  const numberCol = findColumn(["number", "so ao", "shirt"]);
  const countryCol = findColumn(["country", "quoc gia", "nation"]);
  if (nameCol < 0) throw new Error("Không tìm thấy cột tên. Hãy dùng tiêu đề name hoặc tên cầu thủ.");
  return rows.slice(1).map((cells, index) => ({
    id: `csv-${Date.now()}-${index}`,
    name: cells[nameCol] || "",
    position: (cells[positionCol] || "MF").toUpperCase(),
    number: cells[numberCol] || String(index + 1),
    country: cells[countryCol] || "",
  })).filter((player) => player.name);
}

function App() {
  const [game, setGame] = useState(INITIAL_GAME);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("available");
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState("offline");
  const [role, setRole] = useState("");
  const [roomId, setRoomId] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [participantName, setParticipantName] = useState(getSavedParticipantName);
  const [participants, setParticipants] = useState([]);
  const [captainIds, setCaptainIds] = useState([null, null]);
  const [showConnect, setShowConnect] = useState(false);
  const [showNetworkView, setShowNetworkView] = useState(false);
  const [localTeam, setLocalTeam] = useState(0);
  const [participantCount, setParticipantCount] = useState(0);
  const [networkTraffic, setNetworkTraffic] = useState({});
  const signalSessionRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const dataChannelsRef = useRef(new Map());
  const pendingIceCandidatesRef = useRef(new Map());
  const networkTrafficTimersRef = useRef(new Map());
  const pitchRef = useRef(null);
  const signalPollTimerRef = useRef(null);
  const signalPollingRef = useRef(false);
  const signalPollFailuresRef = useRef(0);
  const initialJoinStartedRef = useRef(false);
  const fileRef = useRef(null);
  const gameRef = useRef(game);
  const roleRef = useRef(role);
  const connectionRef = useRef(connection);
  const localTeamRef = useRef(localTeam);
  const participantsRef = useRef(participants);
  const captainIdsRef = useRef(captainIds);

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { roleRef.current = role; }, [role]);
  useEffect(() => { connectionRef.current = connection; }, [connection]);
  useEffect(() => { localTeamRef.current = localTeam; }, [localTeam]);
  useEffect(() => { participantsRef.current = participants; }, [participants]);
  useEffect(() => { captainIdsRef.current = captainIds; }, [captainIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PARTICIPANT_NAME_STORAGE_KEY, participantName);
    } catch (error) {
      console.warn("Could not save the participant name.", error);
    }
  }, [participantName]);

  useEffect(() => {
    const handlePageHide = () => leaveSignalSession();
    window.addEventListener("pagehide", handlePageHide);
    const hash = window.location.hash;
    if (hash.startsWith("#room=") && !initialJoinStartedRef.current) {
      try {
        const code = normalizeRoomId(decodeURIComponent(hash.slice(6)));
        initialJoinStartedRef.current = true;
        setRoomCodeInput(code);
        setShowConnect(true);
        notify("Nhập tên hiển thị để tham gia phòng.");
      } catch {
        initialJoinStartedRef.current = true;
        notify("Link hoặc mã phòng không hợp lệ.");
      }
    }
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.clearTimeout(signalPollTimerRef.current);
      networkTrafficTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const taken = useMemo(() => new Set(game.teams.flatMap((team) => team.players.map(playerId))), [game.teams]);
  const available = useMemo(() => game.players.filter((player) => !taken.has(playerId(player))), [game.players, taken]);
  const shownPlayers = available.filter((player) => player.name.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")));
  const turnSize = game.pickCount === 0 ? 1 : 2;
  const currentTeam = game.currentTeam;
  const captainsAssigned = !role || captainIds.every(Boolean);
  const isMyTurn = captainsAssigned && (connection === "connected" ? currentTeam === localTeam : !role);

  function notify(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3800);
  }

  function sendState(next) {
    gameRef.current = next;
    setGame(next);
    if (roleRef.current === "host") void publishDraftState(next);
  }

  function randomPlayerPosition(teamIndex, teams) {
    const isPortraitPitch = window.matchMedia("(max-width: 760px)").matches;
    const bounds = isPortraitPitch
      ? { xMin: 8, xMax: 92, yMin: teamIndex === 0 ? 8 : 54, yMax: teamIndex === 0 ? 46 : 92 }
      : { xMin: teamIndex === 0 ? 8 : 54, xMax: teamIndex === 0 ? 46 : 92, yMin: 8, yMax: 92 };
    const rect = pitchRef.current?.getBoundingClientRect();
    const width = rect?.width || (isPortraitPitch ? 320 : 800);
    const height = rect?.height || (isPortraitPitch ? 494 : 518);
    const isNarrowScreen = window.matchMedia("(max-width: 430px)").matches;
    const minXGap = ((isNarrowScreen ? 64 : 72) / width) * 100;
    const minYGap = ((isNarrowScreen ? 42 : 48) / height) * 100;
    const slotXGap = ((isNarrowScreen ? 72 : 80) / width) * 100;
    const slotYGap = ((isNarrowScreen ? 46 : 56) / height) * 100;
    const valuesInRange = (min, max, step) => {
      const count = Math.floor((max - min) / step);
      return Array.from({ length: count + 1 }, (_, index) => min + index * step);
    };
    const xPositions = valuesInRange(bounds.xMin, bounds.xMax, slotXGap);
    const yPositions = valuesInRange(bounds.yMin, bounds.yMax, slotYGap);
    const candidates = xPositions.flatMap((x) => yPositions.map((y) => ({ x, y })));

    for (let index = candidates.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[randomIndex]] = [candidates[randomIndex], candidates[index]];
    }

    const occupied = teams.flatMap((team) => team.players);
    return candidates.find((candidate) => occupied.every((player) => (
      Math.abs(candidate.x - player.x) >= minXGap
      || Math.abs(candidate.y - player.y) >= minYGap
    ))) || null;
  }

  function pickPlayer(player, fromRemote = false, remoteTeam = 1) {
    const currentGame = gameRef.current;
    const activeRole = roleRef.current;
    const activeConnection = connectionRef.current;
    const activeTeam = currentGame.currentTeam;
    const currentTaken = new Set(currentGame.teams.flatMap((team) => team.players.map(playerId)));
    if (!player || currentTaken.has(playerId(player))) return;
    if (activeRole && activeConnection !== "connected" && !fromRemote) {
      notify("Hãy kết nối vào phòng trước khi tiếp tục pick.");
      return;
    }
    if (fromRemote && (activeConnection !== "connected" || activeTeam !== remoteTeam)) return;
    if (!fromRemote && activeConnection === "connected" && activeTeam !== localTeamRef.current) {
      notify(`Đang đến lượt ${currentGame.captains[activeTeam]}.`);
      return;
    }
    if (!fromRemote && activeRole && activeConnection === "connected" && localTeamRef.current < 0) {
      notify("Bạn chưa được chọn làm đội trưởng.");
      return;
    }
    const team = currentGame.teams[activeTeam];
    if (team.players.length >= 11) {
      notify(`${team.name} đã đủ 11 cầu thủ.`);
      return;
    }
    if (activeRole !== "host" && activeRole && activeConnection === "connected") {
      void sendDraftCommand({ type: "pick", id: playerId(player) });
      return;
    }
    const position = randomPlayerPosition(activeTeam, currentGame.teams);
    if (!position) {
      notify("Không tìm được vị trí trống trên sân cho cầu thủ này.");
      return;
    }
    const chosen = { ...player, id: playerId(player), ...position };
    const turnPicks = currentGame.turnPicks + 1;
    const endTurn = turnPicks >= (currentGame.pickCount === 0 ? 1 : 2);
    sendState({
      ...currentGame,
      teams: currentGame.teams.map((item, index) => index === activeTeam ? { ...item, players: [...item.players, chosen] } : item),
      history: [...currentGame.history, { player: chosen.name, team: team.name }],
      pickCount: currentGame.pickCount + 1,
      turnPicks: endTurn ? 0 : turnPicks,
      currentTeam: endTurn ? 1 - activeTeam : activeTeam,
    });
  }

  function changePlacement(teamIndex, id, x, y) {
    if (role && localTeam < 0) {
      notify("Bạn chưa được chọn làm đội trưởng.");
      return;
    }
    if (role && role !== "host" && connection === "connected") {
      void sendDraftCommand({ type: "placement", teamIndex, id, x, y });
      return;
    }
    sendState({
      ...game,
      teams: game.teams.map((team, index) => index === teamIndex
        ? { ...team, players: team.players.map((player) => player.id === id ? { ...player, x, y } : player) }
        : team),
    });
  }

  function setTeamField(index, key, value) {
    if (role && role !== "host") return;
    sendState({ ...game, teams: game.teams.map((team, i) => i === index ? { ...team, [key]: value } : team) });
  }

  function setConnectionStatus(status) {
    connectionRef.current = status;
    setConnection(status);
  }

  function changeCaptain(teamIndex, peerId) {
    const next = [...captainIdsRef.current];
    next[teamIndex] = peerId || null;
    captainIdsRef.current = next;
    setCaptainIds(next);
  }

  async function signalRequest(action, payload, keepalive = false) {
    const response = await fetch(`${SIGNALING_BASE_URL}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      keepalive,
    });
    const result = await response.json();
    if (!response.ok) {
      const validationMessage = result.errors ? Object.values(result.errors).flat()[0] : "";
      const error = new Error(validationMessage || result.message || `Lỗi signaling (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function sendDraftMessage(message) {
    const session = signalSessionRef.current;
    if (!session) throw new Error("Bạn chưa tham gia phòng.");
    const targetPeerId = session.role === "host" ? null : session.roomLeaderId;
    if (targetPeerId) {
      if (!sendDataChannelMessage(targetPeerId, message)) {
        throw new Error("Kết nối WebRTC với chủ phòng chưa sẵn sàng.");
      }
      return true;
    }
    return broadcastDraftMessage(message);
  }

  function markNetworkTraffic(peerId, direction) {
    const timer = networkTrafficTimersRef.current.get(peerId);
    if (timer) window.clearTimeout(timer);
    setNetworkTraffic((current) => ({ ...current, [peerId]: { direction, at: Date.now() } }));
    networkTrafficTimersRef.current.set(peerId, window.setTimeout(() => {
      networkTrafficTimersRef.current.delete(peerId);
      setNetworkTraffic((current) => {
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    }, 850));
  }

  function sendDataChannelMessage(peerId, message) {
    const channel = dataChannelsRef.current.get(peerId);
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(JSON.stringify(message));
      markNetworkTraffic(peerId, "out");
      return true;
    } catch (error) {
      notify(`Không gửi được dữ liệu WebRTC: ${error.message}`);
      return false;
    }
  }

  function broadcastDraftMessage(message) {
    let sent = false;
    dataChannelsRef.current.forEach((channel, peerId) => {
      if (channel.readyState === "open") {
        if (sendDataChannelMessage(peerId, message)) sent = true;
      }
    });
    return sent;
  }

  function sendRtcSignal(peerId, message) {
    const session = signalSessionRef.current;
    if (!session) return Promise.reject(new Error("Phiên phòng đã đóng."));
    return signalRequest("send", {
      roomId: session.roomId,
      peerId: session.peerId,
      token: session.token,
      message: { ...message, to: peerId },
    }).then((result) => {
      if (!result.accepted) throw new Error("Máy chủ từ chối thông điệp thiết lập WebRTC.");
      return result;
    });
  }

  function closePeerConnection(peerId) {
    const channel = dataChannelsRef.current.get(peerId);
    if (channel) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onclose = null;
      channel.close();
      dataChannelsRef.current.delete(peerId);
    }
    const peerConnection = peerConnectionsRef.current.get(peerId);
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ondatachannel = null;
      peerConnection.close();
      peerConnectionsRef.current.delete(peerId);
    }
    pendingIceCandidatesRef.current.delete(peerId);
  }

  function closePeerConnections() {
    for (const peerId of peerConnectionsRef.current.keys()) {
      closePeerConnection(peerId);
    }
    dataChannelsRef.current.clear();
    pendingIceCandidatesRef.current.clear();
  }

  function setupDataChannel(peerId, channel) {
    dataChannelsRef.current.set(peerId, channel);
    channel.onopen = () => {
      if (roleRef.current === "host") {
        sendDataChannelMessage(peerId, {
          type: "captains-updated",
          captains: captainIdsRef.current,
        });
        sendDataChannelMessage(peerId, { type: "draft-state", game: gameRef.current });
      } else {
        setConnectionStatus("connected");
      }
    };
    channel.onmessage = (event) => {
      markNetworkTraffic(peerId, "in");
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message && typeof message.type === "string") {
          void handleDraftMessage(message, peerId);
        }
      } catch {
        notify("Nhận được dữ liệu WebRTC không hợp lệ.");
      }
    };
    channel.onclose = () => {
      if (dataChannelsRef.current.get(peerId) === channel) {
        dataChannelsRef.current.delete(peerId);
        if (roleRef.current !== "host") setConnectionStatus("waiting");
      }
    };
  }

  async function createPeerConnection(peerId, isOfferer) {
    const existing = peerConnectionsRef.current.get(peerId);
    if (existing) return existing;

    const peerConnection = new RTCPeerConnection(PEER_CONNECTION_CONFIG);
    peerConnectionsRef.current.set(peerId, peerConnection);
    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate) {
        void sendRtcSignal(peerId, { type: "ice-candidate", candidate: candidate.toJSON() })
          .catch((error) => notify(`Không gửi được ICE candidate: ${error.message}`));
      }
    };
    peerConnection.ondatachannel = ({ channel }) => {
      if (channel.label === "draft") setupDataChannel(peerId, channel);
      else channel.close();
    };
    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === "failed") {
        if (roleRef.current !== "host") setConnectionStatus("waiting");
        notify(`Không thiết lập được kết nối WebRTC với ${participantsRef.current.find((peer) => peer.peerId === peerId)?.name || "người tham gia"}.`);
      }
    };

    if (isOfferer) {
      setupDataChannel(peerId, peerConnection.createDataChannel("draft"));
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await sendRtcSignal(peerId, { type: "offer", offer: peerConnection.localDescription.toJSON() });
      } catch (error) {
        closePeerConnection(peerId);
        throw error;
      }
    }
    return peerConnection;
  }

  async function setRemoteDescription(peerConnection, peerId, description) {
    await peerConnection.setRemoteDescription(description);
    const pendingCandidates = pendingIceCandidatesRef.current.get(peerId) || [];
    pendingIceCandidatesRef.current.delete(peerId);
    for (const candidate of pendingCandidates) {
      await peerConnection.addIceCandidate(candidate);
    }
  }

  async function handleRtcSignal(message) {
    const session = signalSessionRef.current;
    if (!session || !message.from) return;

    if (message.type === "offer") {
      if (session.role === "host" || message.from !== session.roomLeaderId) return;
      const peerConnection = await createPeerConnection(message.from, false);
      await setRemoteDescription(peerConnection, message.from, message.offer);
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await sendRtcSignal(message.from, { type: "answer", answer: peerConnection.localDescription.toJSON() });
      return;
    }

    const peerConnection = peerConnectionsRef.current.get(message.from);
    if (message.type === "ice-candidate" && message.candidate) {
      if (!peerConnection || !peerConnection.remoteDescription) {
        const pending = pendingIceCandidatesRef.current.get(message.from) || [];
        pending.push(message.candidate);
        pendingIceCandidatesRef.current.set(message.from, pending);
      } else {
        await peerConnection.addIceCandidate(message.candidate);
      }
      return;
    }
    if (!peerConnection) return;
    if (message.type === "answer" && session.role === "host") {
      await setRemoteDescription(peerConnection, message.from, message.answer);
    }
  }

  async function publishDraftState(next) {
    broadcastDraftMessage({ type: "draft-state", game: next });
  }

  async function sendDraftCommand(command) {
    try {
      sendDraftMessage({ type: "draft-command", command });
    } catch (error) {
      notify(`Không gửi được thao tác: ${error.message}`);
    }
  }

  function leaveSignalSession() {
    const session = signalSessionRef.current;
    signalSessionRef.current = null;
    window.clearTimeout(signalPollTimerRef.current);
    closePeerConnections();
    if (!session) return;
    void signalRequest("leave", {
      roomId: session.roomId,
      peerId: session.peerId,
      token: session.token,
    }, true).catch(() => {});
  }

  async function handleSignalMessage(message) {
    if (message.type === "peer-joined") {
      if (!participantsRef.current.some((peer) => peer.peerId === message.peerId)) {
        setParticipantCount((count) => count + 1);
        const next = [...participantsRef.current, { peerId: message.peerId, name: message.name, role: message.role }];
        participantsRef.current = next;
        setParticipants(next);
        if (roleRef.current === "host") {
          try {
            await createPeerConnection(message.peerId, true);
          } catch (error) {
            notify(`Không thể mở kết nối WebRTC: ${error.message}`);
          }
        }
      }
      return;
    }

    if (["offer", "answer", "ice-candidate"].includes(message.type)) {
      try {
        await handleRtcSignal(message);
      } catch (error) {
        notify(`Lỗi thiết lập WebRTC: ${error.message}`);
      }
      return;
    }
  }

  function applyCaptainSelection(selected) {
    captainIdsRef.current = selected;
    setCaptainIds(selected);
    const team = selected.indexOf(signalSessionRef.current?.peerId);
    setLocalTeam(team < 0 ? -1 : team);
    localTeamRef.current = team < 0 ? -1 : team;
    const names = selected.map((id) => participantsRef.current.find((peer) => peer.peerId === id)?.name || "");
    const next = { ...gameRef.current, captains: names };
    gameRef.current = next;
    setGame(next);
  }

  async function handleDraftMessage(message, fromPeerId) {
    if (message.type === "captains-updated" && roleRef.current !== "host" && Array.isArray(message.captains)) {
      applyCaptainSelection(message.captains);
      return;
    }

    if (message.type === "draft-state" && roleRef.current !== "host" && message.game) {
      gameRef.current = message.game;
      setGame(message.game);
      return;
    }

    if (message.type === "draft-command" && roleRef.current === "host") {
      const captainTeam = captainIdsRef.current.indexOf(fromPeerId);
      if (captainTeam < 0 || !message.command) return;
      const { command } = message;
      if (command.type === "pick") {
        const player = gameRef.current.players.find((item) => playerId(item) === command.id);
        if (player) pickPlayer(player, true, captainTeam);
      } else if (command.type === "placement") {
        const { teamIndex, id, x, y } = command;
        if (teamIndex !== captainTeam || !Number.isFinite(x) || !Number.isFinite(y)
          || x < 0 || x > 100 || y < 0 || y > 100) return;
        const current = gameRef.current;
        if (!current.teams[teamIndex].players.some((player) => player.id === id)) return;
        const next = {
          ...current,
          teams: current.teams.map((team, index) => index === teamIndex
            ? { ...team, players: team.players.map((player) => player.id === id ? { ...player, x, y } : player) }
            : team),
        };
        sendState(next);
      }
    }
  }

  async function handlePeerLeft(message) {
    setParticipantCount((count) => Math.max(0, count - 1));
    const updatedParticipants = participantsRef.current.filter((peer) => peer.peerId !== message.peerId);
    participantsRef.current = updatedParticipants;
    setParticipants(updatedParticipants);
    closePeerConnection(message.peerId);

    if (roleRef.current === "host" && captainIdsRef.current.includes(message.peerId)) {
      const nextCaptains = captainIdsRef.current.map((id) => id === message.peerId ? null : id);
      captainIdsRef.current = nextCaptains;
      applyCaptainSelection(nextCaptains);
      broadcastDraftMessage({ type: "captains-updated", captains: nextCaptains });
    }

    if (message.peerId === signalSessionRef.current?.roomLeaderId) {
      closePeerConnections();
      setConnectionStatus("offline");
      notify("Chủ phòng đã rời khỏi phòng.");
    }
  }

  async function pollSignals(session) {
    if (signalPollingRef.current || signalSessionRef.current !== session) return;
    signalPollingRef.current = true;
    try {
      const result = await signalRequest("poll", {
        roomId: session.roomId,
        peerId: session.peerId,
        token: session.token,
      });
      signalPollFailuresRef.current = 0;
      for (const message of result.messages) {
        if (message.type === "peer-left") await handlePeerLeft(message);
        else await handleSignalMessage(message);
      }
    } catch (error) {
      signalPollFailuresRef.current += 1;
      if (error.status === 401) {
        leaveSignalSession();
        setConnectionStatus("offline");
        notify("Phiên phòng đã hết hạn. Hãy tạo hoặc tham gia lại.");
        return;
      }
      if (signalPollFailuresRef.current === 3) {
        notify(`Mất liên lạc với máy chủ phòng: ${error.message}`);
      }
    } finally {
      signalPollingRef.current = false;
      if (signalSessionRef.current === session) {
        signalPollTimerRef.current = window.setTimeout(() => pollSignals(session), 1500);
      }
    }
  }

  function startPolling(session) {
    signalPollFailuresRef.current = 0;
    void pollSignals(session);
  }

  async function registerRoom(id, nextRole, displayName) {
    setParticipantName(displayName);
    const joined = await signalRequest("draft/join", {
      roomId: id,
      name: displayName,
    });
    const hostExists = joined.peers.some((peer) => peer.role === "host");
    const roomIsOccupied = nextRole === "host" && joined.peers.length > 0;
    const noHostToJoin = nextRole !== "host" && !hostExists;
    if (roomIsOccupied || noHostToJoin) {
      await signalRequest("leave", {
        roomId: joined.roomId,
        peerId: joined.peerId,
        token: joined.token,
      });
      throw new Error(nextRole === "host" ? "Mã phòng bị trùng, hãy tạo phòng mới." : "Không tìm thấy chủ phòng đang hoạt động.");
    }
    const assignedRole = joined.role === "host" ? "host" : "viewer";
    const session = { ...joined, role: assignedRole };
    signalSessionRef.current = session;
    setRoomId(id);
    setRoomCodeInput(id);
    setParticipantName(displayName);
    setRole(assignedRole);
    roleRef.current = assignedRole;
    setLocalTeam(-1);
    localTeamRef.current = -1;
    participantsRef.current = joined.participants;
    setParticipants(joined.participants);
    captainIdsRef.current = [null, null];
    setCaptainIds([null, null]);
    setParticipantCount(joined.peers.length + 1);
    setConnectionStatus(assignedRole === "host" ? "connected" : "waiting");
    if (assignedRole !== "host") {
      gameRef.current = INITIAL_GAME;
      setGame(INITIAL_GAME);
    }
    startPolling(session);
    return session;
  }

  async function assignCaptains() {
    if (!captainIds[0] || !captainIds[1] || captainIds[0] === captainIds[1]) {
      notify("Hãy chọn hai người khác nhau làm đội trưởng.");
      return;
    }
    if (game.pickCount > 0 && captainIds.some((id, index) => id !== captainIdsRef.current[index])) {
      notify("Không thể đổi đội trưởng sau khi draft đã bắt đầu.");
      return;
    }
    applyCaptainSelection(captainIds);
    broadcastDraftMessage({ type: "captains-updated", captains: captainIds });
    void publishDraftState(gameRef.current);
    notify("Đã chọn hai đội trưởng. Có thể bắt đầu ban-pick.");
  }

  async function createRoom() {
    const displayName = participantName.trim();
    if (!displayName) {
      notify("Hãy nhập tên hiển thị trước khi tạo phòng.");
      return;
    }
    try {
      leaveSignalSession();
      setInviteUrl("");
      const id = createRoomId();
      await registerRoom(id, "host", displayName);
      setInviteUrl(`${window.location.href.split("#")[0]}#room=${id}`);
      notify(`Đã tạo phòng ${id}. Gửi link mời các thành viên.`);
    } catch (error) {
      setConnectionStatus("offline");
      notify(`Không thể tạo phòng: ${error.message}`);
    }
  }

  async function joinRoom(roomIdValue = roomCodeInput) {
    const displayName = participantName.trim();
    if (!displayName) {
      notify("Hãy nhập tên hiển thị trước khi tham gia phòng.");
      return;
    }
    try {
      const id = normalizeRoomId(roomIdValue);
      leaveSignalSession();
      const session = await registerRoom(id, "guest", displayName);
      notify(`Đã vào phòng ${id}. Đang thiết lập kết nối WebRTC với chủ phòng.`);
    } catch (error) {
      setConnectionStatus("offline");
      notify(`Không thể tham gia phòng: ${error.message}`);
    }
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      notify("Đã sao chép.");
    } catch {
      notify("Không thể tự sao chép. Hãy chọn và sao chép nội dung trong ô.");
    }
  }

  function uploadCsv(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const players = parseCsv(String(reader.result));
        if (!players.length) throw new Error("Không có cầu thủ hợp lệ trong tệp.");
        if (roleRef.current && roleRef.current !== "host") {
          notify("Chỉ chủ phòng mới có thể thay đổi danh sách cầu thủ.");
          return;
        }
        sendState({ ...game, players, teams: game.teams.map((team) => ({ ...team, players: [] })), history: [], pickCount: 0, turnPicks: 0, currentTeam: 0 });
        notify(`Đã tải ${players.length} cầu thủ từ ${file.name}.`);
      } catch (error) {
        notify(error.message);
      }
      event.target.value = "";
    };
    reader.onerror = () => notify("Không đọc được tệp CSV.");
    reader.readAsText(file);
  }

  function resetDraft() {
    if (role !== "host" && role) {
      notify("Chỉ chủ phòng có thể đặt lại lượt chọn.");
      return;
    }
    sendState({ ...game, teams: game.teams.map((team) => ({ ...team, players: [] })), history: [], pickCount: 0, turnPicks: 0, currentTeam: 0 });
  }

  function dragStart(event, player, teamIndex) {
    if (role && role !== "host" && (localTeam < 0 || localTeam !== teamIndex)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", JSON.stringify({ id: playerId(player), teamIndex }));
    event.dataTransfer.effectAllowed = "move";
  }

  function dropOnPitch(event) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(6, Math.min(94, ((event.clientY - rect.top) / rect.height) * 100));
    try {
      const dragged = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (dragged.teamIndex !== undefined) changePlacement(dragged.teamIndex, dragged.id, x, y);
      else pickPlayer(game.players.find((player) => playerId(player) === dragged.id));
    } catch {
      notify("Không thể di chuyển cầu thủ.");
    }
  }

  const fieldPlayers = game.teams.flatMap((team, teamIndex) => team.players.map((player) => ({ ...player, teamIndex, color: team.color })));
  const completed = available.length === 0;
  const hostPeerId = signalSessionRef.current?.peerId;
  const networkPeers = participants.filter((peer) => peer.peerId !== hostPeerId);
  const networkNodes = networkPeers.map((peer, index) => {
    const angle = (2 * Math.PI * index) / Math.max(networkPeers.length, 1) - Math.PI / 2;
    return {
      ...peer,
      x: 500 + Math.cos(angle) * 360,
      y: 320 + Math.sin(angle) * 230,
      team: captainIds.indexOf(peer.peerId),
      channelOpen: dataChannelsRef.current.get(peer.peerId)?.readyState === "open",
      traffic: networkTraffic[peer.peerId],
    };
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-ball"><FontAwesomeIcon icon={faFutbol} /></span>PICK<span>UP</span></a>
        <div className="connection-label"><i className={`connection-dot ${connection}`} />{connection === "connected" ? `PHÒNG ONLINE · ${participantCount} NGƯỜI` : connection === "waiting" ? "ĐANG KẾT NỐI PHÒNG" : "PHIÊN CHƠI CỤC BỘ"}</div>
        <div className="topbar-actions">
          {role === "host" && <button className="button button-outline" onClick={() => setShowNetworkView(true)}>Sơ đồ kết nối</button>}
          <button className="button button-outline" onClick={() => setShowConnect((show) => !show)}><FontAwesomeIcon icon={faLink} />　{connection === "connected" ? `Phòng · ${participantCount}` : "Tạo / tham gia phòng"}</button>
        </div>
      </header>

      {showNetworkView && role === "host" && <section className="network-overlay" role="dialog" aria-modal="true" aria-labelledby="network-title">
        <div className="network-window">
          <header className="network-heading">
            <div><div className="eyebrow">WEBRTC · LIVE DATA FLOW</div><h2 id="network-title">Sơ đồ kết nối phòng</h2><p>Mỗi node là một người tham gia; đường sáng khi có dữ liệu đi qua.</p></div>
            <button className="button button-outline" onClick={() => setShowNetworkView(false)}>Đóng</button>
          </header>
          <div className="network-legend"><span><i className="network-legend-line" />Kết nối WebRTC</span><span><i className="network-legend-line active" />Đang truyền dữ liệu</span><span>{participantCount} node trong phòng</span></div>
          <div className="network-graph">
            <svg className="network-lines" viewBox="0 0 1000 640" preserveAspectRatio="none" aria-hidden="true">
              {networkNodes.map((peer) => <line
                key={peer.peerId}
                x1="500"
                y1="320"
                x2={peer.x}
                y2={peer.y}
                className={`network-link ${peer.traffic ? `active ${peer.traffic.direction}` : ""} ${peer.channelOpen ? "open" : "connecting"}`}
              />)}
            </svg>
            <div className="network-node host-node" style={{ left: "50%", top: "50%" }}>
              <span className="network-node-icon">H</span><b>{participantName || "Trưởng phòng"}</b><small>TRƯỞNG PHÒNG · HOST</small><em className="node-status online">ĐANG QUẢN LÝ</em>
            </div>
            {networkNodes.map((peer) => {
              const activityLabel = peer.traffic?.direction === "in" ? "ĐANG GỬI ĐẾN HOST" : "HOST ĐANG GỬI";
              return <div
                key={peer.peerId}
                className={`network-node peer-node ${peer.team >= 0 ? `team-${peer.team}` : ""} ${peer.traffic ? "transmitting" : ""}`}
                style={{ left: `${peer.x / 10}%`, top: `${peer.y / 6.4}%` }}
              >
                <span className="network-node-icon">{peer.name.slice(0, 1).toLocaleUpperCase("vi")}</span>
                <b>{peer.name}</b>
                <small>{peer.team >= 0 ? `ĐỘI TRƯỞNG ${peer.team + 1}` : "NGƯỜI THAM GIA"}</small>
                <em className={`node-status ${peer.channelOpen ? "online" : "pending"}`}>
                  {peer.traffic ? activityLabel : peer.channelOpen ? "ĐÃ KẾT NỐI P2P" : "ĐANG KẾT NỐI"}
                </em>
              </div>;
            })}
            {networkPeers.length === 0 && <div className="network-empty">Chưa có người tham gia khác trong phòng.</div>}
          </div>
        </div>
      </section>}

      <section className="intro">
        <div><div className="eyebrow">FOOTBALL DRAFT ROOM</div><h1>Chọn đội. <span>Ra sân.</span></h1><p>Chọn cầu thủ, xây đội hình trong mơ cùng bạn bè.</p></div>
        <div className="session"><span><FontAwesomeIcon icon={faClock} /></span><div><small>PHIÊN ĐẤU</small><b>{connection === "connected" ? "ĐÃ ĐỒNG BỘ" : "LOCAL · 01"}</b></div></div>
      </section>

      {showConnect && <section className="connect-panel">
        <div className="panel-title"><div><div className="eyebrow">WEBRTC P2P · SERVER CHỈ BẮT TAY KẾT NỐI</div><h2>Tạo phòng & mời bạn chơi</h2></div><button className="icon-button" aria-label="Đóng" onClick={() => setShowConnect(false)}><FontAwesomeIcon icon={faXmark} /></button></div>
        <p>Chủ phòng chọn hai đội trưởng từ danh sách người tham gia; chủ phòng có thể chọn chính mình hoặc chỉ quản lý phòng. Người chưa được chọn làm đội trưởng có quyền xem.</p>
        <div className="connect-columns">
          <div className="connect-card"><b>01 · Tạo phòng</b><span>Chủ phòng tạo link rồi gửi cho người muốn mời vào phòng.</span>{role ? <span>{role === "host" ? `Bạn là chủ phòng${localTeam >= 0 ? ` · Đội trưởng ${localTeam + 1}` : " · chưa tham gia ban-pick"}.` : localTeam >= 0 ? `Bạn là Đội trưởng ${localTeam + 1}.` : "Bạn đang tham gia với quyền xem."}</span> : <><label>Tên hiển thị (bắt buộc)</label><input className="display-name-input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Tên của bạn" maxLength={32} required /><button className="button button-primary" disabled={!participantName.trim()} onClick={createRoom}><FontAwesomeIcon icon={faLink} />　Tạo phòng mới</button></>}
            {inviteUrl && role === "host" && <><label>Mã phòng</label><div className="room-id-row"><strong>{roomId}</strong><button className="button button-outline" onClick={() => copy(roomId)}>Sao chép mã</button></div><label>Link tham gia · gửi cho các thành viên</label><textarea readOnly value={inviteUrl} /><button className="button button-outline" onClick={() => copy(inviteUrl)}>Sao chép link mời</button></>}
            {role === "host" && <div className="captain-picker">
              <label>Đội trưởng 1<select value={captainIds[0] || ""} onChange={(event) => changeCaptain(0, event.target.value)}><option value="">Chọn người tham gia</option>{participants.map((peer) => <option key={peer.peerId} value={peer.peerId} disabled={peer.peerId === captainIds[1]}>{peer.name}</option>)}</select></label>
              <label>Đội trưởng 2<select value={captainIds[1] || ""} onChange={(event) => changeCaptain(1, event.target.value)}><option value="">Chọn người tham gia</option>{participants.map((peer) => <option key={peer.peerId} value={peer.peerId} disabled={peer.peerId === captainIds[0]}>{peer.name}</option>)}</select></label>
              <button className="button button-primary" disabled={!captainIds[0] || !captainIds[1] || captainIds[0] === captainIds[1] || participants.length < 2 || (game.pickCount > 0 && captainIds.every(Boolean))} onClick={assignCaptains}>Xác nhận đội trưởng</button>
              {participants.length < 2 && <span>Cần ít nhất 2 người trong phòng để chọn đội trưởng.</span>}
            </div>}
          </div>
          <div className="connect-card"><b>02 · Tham gia phòng</b><span>Mở link mời, nhập tên và tham gia; hoặc nhập mã phòng 8 ký tự.</span><label>Tên hiển thị (bắt buộc)</label><input className="display-name-input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} placeholder="Tên của bạn" maxLength={32} required disabled={Boolean(role)} /><label>Mã phòng</label><input className="room-id-input" value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} placeholder="VD: A8K4M2QZ" maxLength={8} disabled={Boolean(role)} /><button className="button button-primary" disabled={Boolean(role) || !participantName.trim() || roomCodeInput.length !== 8} onClick={() => joinRoom()}>Tham gia phòng</button>
            {connection === "connected" && <span>{participantCount} người đang trong phòng.</span>}
          </div>
        </div>
      </section>}

      <section className="status-bar"><span><i className="live-dot" />{completed ? "ĐÃ CHỌN XONG" : !captainsAssigned ? "CHỜ CHỌN ĐỘI TRƯỞNG" : game.pickCount ? "DRAFT ĐANG DIỄN RA" : "SẴN SÀNG BẮT ĐẦU"}</span><span>{available.length} CẦU THỦ CÒN LẠI</span><span>THỂ THỨC <b>1 → 2 → 2</b>　·　LƯỢT <b>{game.pickCount + 1}</b></span></section>

      <div className="layout">
        <div className="main-column">
          <section className="teams">
            {game.teams.map((team, index) => <article key={index} className={`team-card ${currentTeam === index && !completed ? "active" : ""}`} style={{ "--team-color": team.color }}>
              <div className="team-top"><span className="team-mark">{String(index + 1).padStart(2, "0")}</span><div className="team-info"><input disabled={role !== "host" && Boolean(role)} value={team.name} onChange={(event) => setTeamField(index, "name", event.target.value)} aria-label="Tên đội" /><small>{game.captains[index]} · {team.players.length}/11 CẦU THỦ</small></div><label className="color-picker" title="Đổi màu đội"><input disabled={role !== "host" && Boolean(role)} type="color" value={team.color} onChange={(event) => setTeamField(index, "color", event.target.value)} /><i /></label><strong>{String(team.players.length).padStart(2, "0")}</strong></div>
              <div className="team-bottom"><label>Đội trưởng <input disabled={role !== "host" && Boolean(role)} value={game.captains[index]} onChange={(event) => sendState({ ...game, captains: game.captains.map((name, i) => i === index ? event.target.value : name) })} /></label>{currentTeam === index && !completed && <span>ĐANG CHỌN</span>}</div>
            </article>)}
          </section>

          <section className="panel pitch-panel">
            <div className="section-head"><div><small>SƠ ĐỒ CHIẾN THUẬT</small><h2>Sân thi đấu <span>4 — 3 — 3</span></h2></div><span className="drag-tip">↕ Kéo cầu thủ để xếp vị trí</span></div>
            <div ref={pitchRef} className="pitch" onDragOver={(event) => event.preventDefault()} onDrop={dropOnPitch}>
              <div className="pitch-lines"><div className="half-line" /><div className="circle" /><div className="spot" /><div className="box box-top" /><div className="box box-bottom" /><div className="goal goal-top" /><div className="goal goal-bottom" /></div>
              {fieldPlayers.map((player) => <div key={player.id} className={`field-player ${player.position === "GK" ? "keeper" : ""}`} style={{ left: `${player.x}%`, top: `${player.y}%`, "--shirt": player.color }} draggable={!role || localTeam >= 0} onDragStart={(event) => dragStart(event, player, player.teamIndex)} title={`${player.name} — kéo để đổi vị trí`}><b>{player.position === "GK" ? "GK" : player.number}</b><span>{player.name.split(" ").slice(-2).join(" ")}</span></div>)}
              {fieldPlayers.length === 0 && <div className="pitch-empty"><b><FontAwesomeIcon icon={faFutbol} /></b><strong>Sân đang chờ đội hình</strong><span>Chọn cầu thủ bên dưới, sau đó kéo vào sân</span></div>}
            </div>
            <div className="legend"><span><i style={{ background: game.teams[0].color }} />{game.teams[0].name}</span><span><i style={{ background: game.teams[1].color }} />{game.teams[1].name}</span><span><b>GK</b> Thủ môn</span></div>
          </section>

          <section className="panel roster">
            <div className="section-head"><div><small>THỊ TRƯỜNG CẦU THỦ</small><h2>Chọn cầu thủ <em>{available.length}</em></h2></div><div className="roster-tools"><label className="search"><FontAwesomeIcon icon={faMagnifyingGlass} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm cầu thủ..." /></label><input ref={fileRef} type="file" accept=".csv,text/csv" className="visually-hidden" onChange={uploadCsv} /><button className="button button-primary import" disabled={Boolean(role && role !== "host")} onClick={() => fileRef.current?.click()}><FontAwesomeIcon icon={faUpload} />　Tải CSV</button></div></div>
            <div className="pick-hint"><b><FontAwesomeIcon icon={faArrowRight} /></b>{completed ? "Đã chọn hết cầu thủ trong danh sách." : <>{game.captains[currentTeam]} đến lượt — chọn <strong>{turnSize - game.turnPicks} cầu thủ</strong>.</>}<span>1　›　2　›　2　›　2</span></div>
            <div className="roster-nav"><div><button className={tab === "available" ? "selected" : ""} onClick={() => setTab("available")}>Cầu thủ tự do <i>{available.length}</i></button><button className={tab === "picked" ? "selected" : ""} onClick={() => setTab("picked")}>Đã chọn <i>{game.history.length}</i></button></div><button className="reset" disabled={!game.history.length || (role && role !== "host")} onClick={resetDraft}><FontAwesomeIcon icon={faRotateLeft} />　Đặt lại</button></div>
            {tab === "available" ? shownPlayers.length ? <div className="player-grid">{shownPlayers.map((player, index) => <button key={playerId(player)} className="player-card" disabled={!isMyTurn || completed} onClick={() => pickPlayer(player)} draggable onDragStart={(event) => dragStart(event, player)}><span className={`player-avatar avatar-${index % 5}`}>{player.position === "GK" ? "GK" : player.name.split(" ").at(-1).slice(0, 1)}</span><span className="player-copy"><b>{player.name}</b><small>{player.position}　·　{player.country || "—"}</small></span><i>{player.number}</i><span className="plus"><FontAwesomeIcon icon={faPlus} /></span></button>)}</div> : <div className="empty-list">{available.length ? "Không tìm thấy cầu thủ phù hợp." : "Không còn cầu thủ tự do."}</div> : game.history.length ? <div className="history">{[...game.history].reverse().map((entry, index) => <div key={`${entry.player}-${index}`}><i>{String(game.history.length - index).padStart(2, "0")}</i><b>{entry.player}</b><span>{entry.team}</span></div>)}</div> : <div className="empty-list">Chưa có cầu thủ nào được chọn.</div>}
            <div className="csv-note">CSV cần cột <code>name</code>; có thể thêm <code>position</code>, <code>number</code>, <code>country</code>. <a href={`data:text/csv;charset=utf-8,${encodeURIComponent("name,position,number,country\nNguyen Van A,FW,9,VN")}`} download="mau-cau-thu.csv">Tải file mẫu</a></div>
          </section>
        </div>

        <aside className="sidebar">
          <section className="panel side-panel"><div className="side-heading"><small>TRẠNG THÁI LƯỢT</small><b>#{String(game.pickCount + 1).padStart(2, "0")}</b></div><div className="turn-card"><span style={{ background: game.teams[currentTeam].color }}><FontAwesomeIcon icon={faStar} /></span><div><small>ĐANG ĐẾN LƯỢT</small><b>{game.captains[currentTeam]}</b></div></div><div className="side-stats"><div><small>Đội</small><b><i style={{ background: game.teams[currentTeam].color }} />{game.teams[currentTeam].name}</b></div><div><small>Số lượt chọn</small><b>{turnSize - game.turnPicks} cầu thủ</b></div></div><div className="progress"><div><i style={{ width: `${game.pickCount / Math.max(1, game.players.length) * 100}%` }} /></div><small><span>Tiến độ draft</span>{game.pickCount}/{game.players.length}</small></div></section>
          <section className="panel squad"><div className="side-heading"><div><small>ĐỘI HÌNH CỦA BẠN</small><h3>Đội hình thi đấu</h3></div><span><FontAwesomeIcon icon={faListCheck} /></span></div>
            {game.teams.map((team, index) => <div className="squad-team" key={index}><div className="squad-head"><i style={{ background: team.color }} /><b>{team.name}</b><span>{team.players.length}/11</span></div>{team.players.length ? <div className="squad-list">{team.players.map((player) => <div key={player.id} draggable onDragStart={(event) => dragStart(event, player, index)}><b className={player.position === "GK" ? "mini-keeper" : ""} style={{ "--shirt": team.color }}>{player.position === "GK" ? "GK" : player.number}</b><span>{player.name}</span><small>{player.position}</small></div>)}</div> : <div className="squad-empty">Chưa có cầu thủ nào</div>}</div>)}
          </section>
          <section className="tip"><b><FontAwesomeIcon icon={faLightbulb} />　MẸO NHANH</b><p>Kéo cầu thủ từ danh sách lên sân để xếp vị trí. Kéo lại cầu thủ trên sân để thay đổi đội hình.</p></section>
          <footer>MADE FOR THE LOVE OF THE GAME　<FontAwesomeIcon icon={faFutbol} /></footer>
        </aside>
      </div>
      {notice && <div className="toast" role="status">✓　{notice}</div>}
    </main>
  );
}

export default App;
