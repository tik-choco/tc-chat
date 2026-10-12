// Fixed Ed25519 seed 01..20; fixture for legacy browser and mistl all-field verifiers.
export const roomBindingVectors = [
  {
    "wire": {
      "type": "tc-chat:post",
      "id": "bound-post",
      "roomId": "room-bound",
      "fromId": "did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
      "timestamp": 1234,
      "fromName": "Alice",
      "surface": "chat",
      "parentId": null,
      "kind": "text",
      "cid": "body",
      "signature": "EmMnsNMbzlTmdAk4X8s5gcJLm0E0-tWfdbt4DceTcZOPxiAqGuBfmvre6UwOgB1xovdhC4hNaLSeNlUgOQkBCA"
    },
    "payload": "{\"cid\":\"body\",\"fromId\":\"did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7\",\"fromName\":\"Alice\",\"id\":\"bound-post\",\"kind\":\"text\",\"parentId\":null,\"roomId\":\"room-bound\",\"surface\":\"chat\",\"timestamp\":1234,\"type\":\"tc-chat:post\"}"
  },
  {
    "wire": {
      "type": "tc-chat:reaction",
      "id": "bound-reaction",
      "roomId": "room-bound",
      "fromId": "did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
      "timestamp": 1235,
      "fromName": "Alice",
      "targetId": "post",
      "emoji": "👍",
      "op": "add",
      "signature": "WKSGKN3ebHG4ns_Xf4tFcRQaFXwmvXz5J9JCB8BiANbxOxvAFP1TrujphO3CM1kExVPWEP79CZLghCWwWABPBA"
    },
    "payload": "{\"emoji\":\"👍\",\"fromId\":\"did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7\",\"fromName\":\"Alice\",\"id\":\"bound-reaction\",\"op\":\"add\",\"roomId\":\"room-bound\",\"targetId\":\"post\",\"timestamp\":1235,\"type\":\"tc-chat:reaction\"}"
  },
  {
    "wire": {
      "type": "tc-chat:post-edit",
      "id": "bound-post-edit",
      "roomId": "room-bound",
      "fromId": "did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
      "timestamp": 1236,
      "fromName": "Alice",
      "surface": "chat",
      "targetId": "post",
      "cid": "edited-body",
      "signature": "jasW2RgOy6kNkaQPzYfJdlo4IbwTmgQ9xgzKEdkZVNmtZNiq6EQUFdyTr9ARwnV1jXK1ILA2WoY8y2Jcgij0CA"
    },
    "payload": "{\"cid\":\"edited-body\",\"fromId\":\"did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7\",\"fromName\":\"Alice\",\"id\":\"bound-post-edit\",\"roomId\":\"room-bound\",\"surface\":\"chat\",\"targetId\":\"post\",\"timestamp\":1236,\"type\":\"tc-chat:post-edit\"}"
  },
  {
    "wire": {
      "type": "tc-chat:post-delete",
      "id": "bound-post-delete",
      "roomId": "room-bound",
      "fromId": "did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
      "timestamp": 1237,
      "fromName": "Alice",
      "surface": "chat",
      "targetId": "post",
      "signature": "9JZJSKI4DQzq6PMGHu3FlfpDNKmVSNZQWBlj6dCPzA_JDSiD2c73zENRWvw-sDsj3Qp1cKoKSF27HmgqWsVMCw"
    },
    "payload": "{\"fromId\":\"did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7\",\"fromName\":\"Alice\",\"id\":\"bound-post-delete\",\"roomId\":\"room-bound\",\"surface\":\"chat\",\"targetId\":\"post\",\"timestamp\":1237,\"type\":\"tc-chat:post-delete\"}"
  },
  {
    "wire": {
      "type": "tc-chat:escrow-config",
      "id": "bound-escrow-config",
      "roomId": "room-bound",
      "fromId": "did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7",
      "timestamp": 1238,
      "v": 1,
      "rev": 1,
      "mode": "auto",
      "mistlRoom": "",
      "signature": "_cpRRwyCieIkMWw6OyMpDsUIu08aqHdKAuOdFIFnjK5sYIevmM4PyyLK4cGNiYgEFN5pFrCmWTPVYQ8t3droCQ"
    },
    "payload": "{\"fromId\":\"did:key:z6MkneMkZqwqRiU5mJzSG3kDwzt9P8C59N4NGTfBLfSGE7c7\",\"id\":\"bound-escrow-config\",\"mistlRoom\":\"\",\"mode\":\"auto\",\"rev\":1,\"roomId\":\"room-bound\",\"timestamp\":1238,\"type\":\"tc-chat:escrow-config\",\"v\":1}"
  }
] as const;
