#!/usr/bin/env python3
"""
Swarm Protocol — Peer-to-Peer Agent Communication via Redis Blackboard

Enables autonomous agents to:
1. Communicate directly via shared Redis memory (no main session relay)
2. Hand over tasks to peer agents
3. Spawn Shadow Agents with different profiles when blocked
4. Track lineage and message flow for visualization

Architecture:
- Each agent gets a unique swarm_id (e.g., "research-001", "shadow-002")
- Agents write messages to Redis channels + persistent blackboard
- Agents can spawn Shadow Agents with different IP/User-Agent profiles
- Full message history persisted for debugging and visualization

Usage:
    from tools.swarm_protocol import SwarmAgent, SwarmMessage, ShadowProfile
    
    agent = SwarmAgent("research-001", role="research")
    agent.broadcast("Found critical data about X")
    agent.handover_task("scraper-002", task_state={"url": "...", "cookies": "..."})
    shadow = agent.spawn_shadow(reason="IP blocked", profile=ShadowProfile.BRAZIL_MOBILE)
"""

import json
import os
import redis
import time
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Optional, Dict, Any, List

# ─── Redis Connection ─────────────────────────────────────────

def get_redis() -> redis.Redis:
    """Get Redis connection (localhost:6379 by default)."""
    return redis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        db=int(os.getenv("REDIS_SWARM_DB", "1")),  # Use DB 1 for swarm
        decode_responses=True
    )

# ─── Shadow Profiles ──────────────────────────────────────────

class ShadowProfile(Enum):
    """Predefined profiles for Shadow Agents (different IP/User-Agent combos)."""
    
    DEFAULT = "default"
    BRAZIL_DESKTOP = "brazil_desktop"
    BRAZIL_MOBILE = "brazil_mobile"
    USA_DESKTOP = "usa_desktop"
    ASIA_MOBILE = "asia_mobile"
    RESIDENTIAL_PROXY = "residential_proxy"
    DATACENTER = "datacenter"
    
    def get_config(self) -> Dict[str, str]:
        """Get proxy/user-agent config for this profile."""
        profiles = {
            "default": {
                "proxy": None,
                "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "country": "US"
            },
            "brazil_desktop": {
                "proxy": "br-proxy-pool",  # Would be resolved by proxy manager
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
                "country": "BR"
            },
            "brazil_mobile": {
                "proxy": "br-mobile-proxy",
                "user_agent": "Mozilla/5.0 (Linux; Android 13; SM-S911B) Chrome/120.0 Mobile",
                "country": "BR"
            },
            "usa_desktop": {
                "proxy": "us-proxy-pool",
                "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1",
                "country": "US"
            },
            "asia_mobile": {
                "proxy": "asia-mobile-proxy",
                "user_agent": "Mozilla/5.0 (Linux; Android 12; Pixel 6) Chrome/120.0 Mobile",
                "country": "SG"
            },
            "residential_proxy": {
                "proxy": "residential-pool",
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
                "country": "random"
            },
            "datacenter": {
                "proxy": None,
                "user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
                "country": "US"
            }
        }
        return profiles.get(self.value, profiles["default"])

# ─── Message Types ────────────────────────────────────────────

class MessageType(Enum):
    BROADCAST = "broadcast"           # Public message to all agents
    DIRECT = "direct"                 # Direct message to specific agent
    TASK_HANDOVER = "task_handover"   # Hand over task state to another agent
    STATUS_UPDATE = "status_update"   # Agent status change
    SPAWN_SHADOW = "spawn_shadow"     # Notification of shadow agent spawn
    ERROR = "error"                   # Error report
    RESULT = "result"                 # Task completion result
    REQUEST_HELP = "request_help"     # Agent requesting assistance

@dataclass
class SwarmMessage:
    """A message in the swarm protocol."""
    msg_id: str
    timestamp: float
    sender_id: str
    msg_type: MessageType
    content: Any
    recipient_id: Optional[str] = None  # None = broadcast
    parent_id: Optional[str] = None     # For thread/lineage tracking
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> dict:
        d = asdict(self)
        d["msg_type"] = self.msg_type.value
        # Convert None values to empty strings for Redis
        return {k: (v if v is not None else "") for k, v in d.items()}
    
    @classmethod
    def from_dict(cls, data: dict) -> "SwarmMessage":
        data["msg_type"] = MessageType(data["msg_type"])
        return cls(**data)

# ─── Agent Status ─────────────────────────────────────────────

class AgentStatus(Enum):
    SPAWNING = "spawning"
    ACTIVE = "active"
    WORKING = "working"
    BLOCKED = "blocked"        # Hit a bottleneck (rate limit, captcha, etc.)
    WAITING = "waiting"        # Waiting for another agent
    COMPLETED = "completed"
    FAILED = "failed"
    SHADOWED = "shadowed"      # Replaced by shadow agent

@dataclass
class AgentInfo:
    """Agent registration info."""
    agent_id: str
    role: str
    status: AgentStatus
    parent_id: Optional[str]
    spawn_time: float
    last_heartbeat: float
    profile: Dict[str, str]
    metadata: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        # Serialize complex types for Redis
        result = {}
        for k, v in d.items():
            if v is None:
                result[k] = ""
            elif isinstance(v, (dict, list)):
                result[k] = json.dumps(v)
            else:
                result[k] = v
        return result
    
    @classmethod
    def from_dict(cls, data: dict) -> "AgentInfo":
        # Deserialize JSON strings back to complex types
        if "status" in data:
            data["status"] = AgentStatus(data["status"])
        if "profile" in data and isinstance(data["profile"], str):
            data["profile"] = json.loads(data["profile"]) if data["profile"] else {}
        if "metadata" in data and isinstance(data["metadata"], str):
            data["metadata"] = json.loads(data["metadata"]) if data["metadata"] else None
        # Convert empty strings back to None
        data = {k: (None if v == "" else v) for k, v in data.items()}
        return cls(**data)

# ─── Swarm Agent ──────────────────────────────────────────────

class SwarmAgent:
    """
    An autonomous agent in the swarm with Redis blackboard communication.
    
    Features:
    - Direct peer-to-peer messaging (no main session relay)
    - Task handover to other agents
    - Shadow agent spawning with different profiles
    - Full message history persistence
    """
    
    def __init__(self, agent_id: str, role: str, parent_id: Optional[str] = None,
                 profile: Optional[ShadowProfile] = None):
        self.agent_id = agent_id
        self.role = role
        self.parent_id = parent_id
        self.profile = (profile or ShadowProfile.DEFAULT).get_config()
        self.redis = get_redis()
        self.status = AgentStatus.SPAWNING
        
        # Redis key prefixes
        self.AGENT_KEY = f"swarm:agent:{agent_id}"
        self.MESSAGES_KEY = f"swarm:messages:{agent_id}"
        self.BLACKBOARD_KEY = "swarm:blackboard"
        self.AGENTS_SET = "swarm:agents:active"
        self.LINEAGE_KEY = "swarm:lineage"
        
        # Register agent
        self._register()
    
    def _register(self):
        """Register this agent in the swarm."""
        info = AgentInfo(
            agent_id=self.agent_id,
            role=self.role,
            status=self.status,
            parent_id=self.parent_id,
            spawn_time=time.time(),
            last_heartbeat=time.time(),
            profile=self.profile
        )
        
        # Store agent info
        self.redis.hset(self.AGENT_KEY, mapping=info.to_dict())
        
        # Add to active agents set
        self.redis.sadd(self.AGENTS_SET, self.agent_id)
        
        # Record lineage
        if self.parent_id:
            self.redis.hset(self.LINEAGE_KEY, self.agent_id, self.parent_id)
        
        self.set_status(AgentStatus.ACTIVE)
    
    def set_status(self, status: AgentStatus):
        """Update agent status."""
        self.status = status
        self.redis.hset(self.AGENT_KEY, "status", status.value)
        self.redis.hset(self.AGENT_KEY, "last_heartbeat", time.time())
        
        # Broadcast status change
        self.send_message(
            msg_type=MessageType.STATUS_UPDATE,
            content={"status": status.value, "agent_id": self.agent_id, "role": self.role}
        )
    
    def send_message(self, msg_type: MessageType, content: Any,
                    recipient_id: Optional[str] = None,
                    parent_id: Optional[str] = None,
                    metadata: Optional[Dict] = None) -> str:
        """
        Send a message to the swarm.
        
        Args:
            msg_type: Type of message
            content: Message payload (any JSON-serializable data)
            recipient_id: Specific recipient (None = broadcast)
            parent_id: Parent message ID (for threading)
            metadata: Additional metadata
        
        Returns:
            Message ID
        """
        msg = SwarmMessage(
            msg_id=str(uuid.uuid4()),
            timestamp=time.time(),
            sender_id=self.agent_id,
            msg_type=msg_type,
            content=content,
            recipient_id=recipient_id,
            parent_id=parent_id,
            metadata=metadata
        )
        
        # Store in sender's message list
        self.redis.rpush(self.MESSAGES_KEY, json.dumps(msg.to_dict()))
        
        # Store in global blackboard
        self.redis.rpush(self.BLACKBOARD_KEY, json.dumps(msg.to_dict()))
        
        # Publish to Redis pubsub for real-time delivery
        channel = f"swarm:channel:{recipient_id}" if recipient_id else "swarm:channel:broadcast"
        self.redis.publish(channel, json.dumps(msg.to_dict()))
        
        return msg.msg_id
    
    def broadcast(self, content: Any, metadata: Optional[Dict] = None) -> str:
        """Broadcast a message to all agents."""
        return self.send_message(MessageType.BROADCAST, content, metadata=metadata)
    
    def direct_message(self, recipient_id: str, content: Any, metadata: Optional[Dict] = None) -> str:
        """Send direct message to specific agent."""
        return self.send_message(MessageType.DIRECT, content, recipient_id=recipient_id, metadata=metadata)
    
    def handover_task(self, recipient_id: str, task_state: Dict[str, Any],
                     reason: str = "task handover") -> str:
        """
        Hand over task to another agent with full state transfer.
        
        Args:
            recipient_id: Agent to hand over to
            task_state: Complete task state (URLs, cookies, progress, etc.)
            reason: Reason for handover
        
        Returns:
            Message ID
        """
        content = {
            "reason": reason,
            "task_state": task_state,
            "handover_time": time.time(),
            "original_agent": self.agent_id
        }
        
        msg_id = self.send_message(
            msg_type=MessageType.TASK_HANDOVER,
            content=content,
            recipient_id=recipient_id,
            metadata={"critical": True}
        )
        
        # Update own status
        self.set_status(AgentStatus.WAITING)
        
        return msg_id
    
    def spawn_shadow(self, reason: str, profile: ShadowProfile,
                    task_state: Optional[Dict[str, Any]] = None) -> str:
        """
        Spawn a Shadow Agent with different profile (IP/User-Agent).
        
        When an agent gets blocked (rate limit, captcha, IP ban), it can
        proactively spawn a shadow with a different network profile.
        
        Args:
            reason: Why shadow is needed (e.g., "IP blocked", "captcha")
            profile: Shadow profile to use
            task_state: State to transfer to shadow
        
        Returns:
            Shadow agent ID
        """
        # Generate shadow ID
        shadow_id = f"shadow-{self.agent_id}-{int(time.time())}"
        
        # Notify swarm
        content = {
            "original_agent": self.agent_id,
            "shadow_id": shadow_id,
            "reason": reason,
            "profile": profile.value,
            "task_state": task_state,
            "spawn_time": time.time()
        }
        
        self.send_message(
            msg_type=MessageType.SPAWN_SHADOW,
            content=content,
            metadata={"critical": True}
        )
        
        # Update status
        self.set_status(AgentStatus.SHADOWED)
        
        # Store shadow spawn record
        self.redis.hset(f"swarm:shadows:{self.agent_id}", shadow_id, json.dumps(content))
        
        return shadow_id
    
    def request_help(self, problem: str, context: Optional[Dict] = None) -> str:
        """Request help from other agents in the swarm."""
        content = {
            "problem": problem,
            "context": context,
            "requester": self.agent_id,
            "role": self.role
        }
        return self.send_message(MessageType.REQUEST_HELP, content)
    
    def report_error(self, error: str, context: Optional[Dict] = None) -> str:
        """Report an error to the swarm."""
        content = {
            "error": error,
            "context": context,
            "agent": self.agent_id,
            "timestamp": time.time()
        }
        return self.send_message(MessageType.ERROR, content)
    
    def report_result(self, result: Any, metadata: Optional[Dict] = None) -> str:
        """Report task completion result."""
        self.set_status(AgentStatus.COMPLETED)
        return self.send_message(MessageType.RESULT, result, metadata=metadata)
    
    def get_messages(self, since: Optional[float] = None, limit: int = 100) -> List[SwarmMessage]:
        """
        Get messages from personal inbox.
        
        Args:
            since: Unix timestamp to get messages after
            limit: Max messages to return
        
        Returns:
            List of messages
        """
        raw = self.redis.lrange(self.MESSAGES_KEY, -limit, -1)
        messages = [SwarmMessage.from_dict(json.loads(m)) for m in raw]
        
        if since:
            messages = [m for m in messages if m.timestamp > since]
        
        return messages
    
    def subscribe_realtime(self) -> redis.client.PubSub:
        """
        Subscribe to real-time messages via Redis pubsub.
        
        Returns:
            Pubsub object (iterate with .listen())
        
        Example:
            pubsub = agent.subscribe_realtime()
            for message in pubsub.listen():
                if message['type'] == 'message':
                    data = json.loads(message['data'])
                    print(f"Got message: {data}")
        """
        pubsub = self.redis.pubsub()
        pubsub.subscribe(f"swarm:channel:{self.agent_id}", "swarm:channel:broadcast")
        return pubsub
    
    def shutdown(self):
        """Clean shutdown of agent."""
        self.set_status(AgentStatus.COMPLETED)
        self.redis.srem(self.AGENTS_SET, self.agent_id)
        self.redis.close()

# ─── Swarm Query API ──────────────────────────────────────────

class SwarmQuery:
    """Query the swarm state (for visualization, debugging, etc.)."""
    
    def __init__(self):
        self.redis = get_redis()
    
    def get_active_agents(self) -> List[AgentInfo]:
        """Get all active agents."""
        agent_ids = self.redis.smembers("swarm:agents:active")
        agents = []
        for aid in agent_ids:
            data = self.redis.hgetall(f"swarm:agent:{aid}")
            if data:
                agents.append(AgentInfo.from_dict(data))
        return agents
    
    def get_agent_info(self, agent_id: str) -> Optional[AgentInfo]:
        """Get info for specific agent."""
        data = self.redis.hgetall(f"swarm:agent:{agent_id}")
        return AgentInfo.from_dict(data) if data else None
    
    def get_blackboard(self, limit: int = 100) -> List[SwarmMessage]:
        """Get recent messages from global blackboard."""
        raw = self.redis.lrange("swarm:blackboard", -limit, -1)
        return [SwarmMessage.from_dict(json.loads(m)) for m in raw]
    
    def get_lineage(self) -> Dict[str, str]:
        """Get full agent lineage tree (child -> parent mapping)."""
        return self.redis.hgetall("swarm:lineage")
    
    def get_agent_messages(self, agent_id: str, limit: int = 50) -> List[SwarmMessage]:
        """Get messages sent by specific agent."""
        raw = self.redis.lrange(f"swarm:messages:{agent_id}", -limit, -1)
        return [SwarmMessage.from_dict(json.loads(m)) for m in raw]
    
    def get_shadows(self, agent_id: str) -> Dict[str, Any]:
        """Get shadow agents spawned by this agent."""
        data = self.redis.hgetall(f"swarm:shadows:{agent_id}")
        return {k: json.loads(v) for k, v in data.items()}
    
    def clear_swarm(self):
        """Clear all swarm data (use with caution!)."""
        keys = self.redis.keys("swarm:*")
        if keys:
            self.redis.delete(*keys)

# ─── CLI ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python3 swarm_protocol.py test              # Run test scenario")
        print("  python3 swarm_protocol.py clear             # Clear swarm data")
        print("  python3 swarm_protocol.py agents            # List active agents")
        print("  python3 swarm_protocol.py blackboard        # Show recent messages")
        sys.exit(1)
    
    cmd = sys.argv[1]
    
    if cmd == "test":
        print("🧪 Testing Swarm Protocol...\n")
        
        # Spawn primary agent
        agent1 = SwarmAgent("research-001", role="research")
        print(f"✓ Spawned {agent1.agent_id} (role: {agent1.role})")
        
        # Broadcast message
        agent1.broadcast("Starting research phase")
        print("✓ Broadcast message sent")
        
        # Spawn secondary agent
        agent2 = SwarmAgent("scraper-001", role="scraper", parent_id=agent1.agent_id)
        print(f"✓ Spawned {agent2.agent_id} (parent: {agent2.parent_id})")
        
        # Simulate getting blocked
        agent2.set_status(AgentStatus.BLOCKED)
        agent2.report_error("IP rate limited")
        print("✓ Agent 2 blocked, reported error")
        
        # Spawn shadow agent
        shadow_id = agent2.spawn_shadow(
            reason="IP rate limit",
            profile=ShadowProfile.BRAZIL_MOBILE,
            task_state={"url": "https://example.com", "cookies": {}}
        )
        print(f"✓ Spawned shadow agent: {shadow_id}")
        
        # Hand over task
        agent1.handover_task(agent2.agent_id, task_state={"data": "important"})
        print("✓ Task handover completed")
        
        # Query swarm state
        query = SwarmQuery()
        agents = query.get_active_agents()
        blackboard = query.get_blackboard()
        
        print(f"\n📊 Swarm State:")
        print(f"   Active agents: {len(agents)}")
        print(f"   Messages: {len(blackboard)}")
        print(f"   Lineage: {query.get_lineage()}")
        
        agent1.shutdown()
        agent2.shutdown()
        print("\n✓ Test complete")
    
    elif cmd == "clear":
        query = SwarmQuery()
        query.clear_swarm()
        print("✓ Swarm data cleared")
    
    elif cmd == "agents":
        query = SwarmQuery()
        agents = query.get_active_agents()
        print(f"Active Agents ({len(agents)}):")
        for a in agents:
            print(f"  • {a.agent_id:20s} role={a.role:15s} status={a.status.value:10s} parent={a.parent_id or 'none'}")
    
    elif cmd == "blackboard":
        query = SwarmQuery()
        messages = query.get_blackboard(limit=20)
        print(f"Recent Messages ({len(messages)}):")
        for m in messages:
            ts = datetime.fromtimestamp(m.timestamp).strftime("%H:%M:%S")
            print(f"  [{ts}] {m.sender_id:15s} → {m.msg_type.value:15s} {str(m.content)[:60]}")
    
    else:
        print(f"Unknown command: {cmd}")
        sys.exit(1)
