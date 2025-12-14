# API Reference

This document describes the REST API endpoints for the Agentic Tasks platform.

## Authentication

All endpoints require authentication. Include user authentication headers with each request.

## Base URL

```
/api
```

## Endpoints

### Conversations

#### Create Conversation

```http
POST /conversations
```

Creates a new conversation.

**Request Body:**
```json
{
  "title": "string (optional)"
}
```

**Response (201 Created):**
```json
{
  "conversation": {
    "id": "string",
    "userId": "string",
    "title": "string",
    "status": "active",
    "schedule": null,
    "nextRunAt": null,
    "state": {
      "context": {},
      "step": "initial",
      "data": {},
      "pendingQuestion": null
    },
    "createdAt": "ISO-8601 date",
    "updatedAt": "ISO-8601 date"
  }
}
```

---

#### List Conversations

```http
GET /conversations
```

Returns all conversations for the authenticated user.

**Response (200 OK):**
```json
{
  "conversations": [
    {
      "id": "string",
      "userId": "string",
      "title": "string",
      "status": "active | background | waiting_input | archived",
      "schedule": {
        "type": "cron | scheduled | immediate",
        "cronExpression": "string | null",
        "runAt": "ISO-8601 date | null"
      } | null,
      "nextRunAt": "ISO-8601 date | null",
      "state": { ... },
      "createdAt": "ISO-8601 date",
      "updatedAt": "ISO-8601 date"
    }
  ]
}
```

---

#### Get Conversation

```http
GET /conversations/:id
```

Returns a specific conversation with its message history.

**Path Parameters:**
- `id` - Conversation ID

**Response (200 OK):**
```json
{
  "conversation": { ... },
  "messages": [
    {
      "id": "string",
      "conversationId": "string",
      "role": "user | assistant | system",
      "content": "string",
      "source": "chat | worker",
      "createdAt": "ISO-8601 date"
    }
  ]
}
```

**Error Responses:**
- `404 Not Found` - Conversation does not exist
- `403 Forbidden` - Conversation belongs to another user

---

#### Send Message

```http
POST /conversations/:id/messages
```

Sends a message to a conversation and gets Claude's response.

**Path Parameters:**
- `id` - Conversation ID

**Request Body:**
```json
{
  "content": "string (required, min 1 character)"
}
```

**Response (200 OK):**
```json
{
  "message": {
    "id": "string",
    "conversationId": "string",
    "role": "user",
    "content": "string",
    "source": "chat",
    "createdAt": "ISO-8601 date"
  },
  "assistantMessage": {
    "id": "string",
    "conversationId": "string",
    "role": "assistant",
    "content": "string",
    "source": "chat",
    "createdAt": "ISO-8601 date"
  },
  "conversationUpdated": true | false,
  "newStatus": "background | waiting_input | active | null"
}
```

**Error Responses:**
- `400 Bad Request` - Cannot send to archived conversation
- `404 Not Found` - Conversation does not exist
- `403 Forbidden` - Conversation belongs to another user

---

#### Update Conversation

```http
PATCH /conversations/:id
```

Updates conversation properties (title, status).

**Path Parameters:**
- `id` - Conversation ID

**Request Body:**
```json
{
  "title": "string (optional)",
  "status": "active | archived (optional)"
}
```

**Response (200 OK):**
```json
{
  "conversation": { ... }
}
```

**Notes:**
- Archiving a conversation with background work will stop the scheduled task
- Only `active` and `archived` status transitions are allowed via PATCH

---

#### Delete Conversation

```http
DELETE /conversations/:id
```

Permanently deletes a conversation and all its messages.

**Path Parameters:**
- `id` - Conversation ID

**Response (200 OK):**
```json
{
  "success": true
}
```

---

### Notifications

#### List Notifications

```http
GET /notifications
```

Returns notifications for the authenticated user.

**Query Parameters:**
- `unread` - Filter to unread only (`true` or `false`)

**Response (200 OK):**
```json
{
  "notifications": [
    {
      "id": "string",
      "userId": "string",
      "conversationId": "string | null",
      "title": "string",
      "body": "string",
      "isRead": true | false,
      "createdAt": "ISO-8601 date"
    }
  ]
}
```

---

#### Get Unread Count

```http
GET /notifications/unread/count
```

Returns the count of unread notifications.

**Response (200 OK):**
```json
{
  "count": 5
}
```

---

#### Mark Notification Read

```http
PATCH /notifications/:id
```

Marks a notification as read.

**Path Parameters:**
- `id` - Notification ID

**Request Body:**
```json
{
  "isRead": true
}
```

**Response (200 OK):**
```json
{
  "notification": { ... }
}
```

---

#### Mark All Read

```http
POST /notifications/mark-all-read
```

Marks all notifications as read for the authenticated user.

**Response (200 OK):**
```json
{
  "success": true
}
```

---

#### Delete Notification

```http
DELETE /notifications/:id
```

Permanently deletes a notification.

**Path Parameters:**
- `id` - Notification ID

**Response (200 OK):**
```json
{
  "success": true
}
```

---

### Health Check

```http
GET /health
```

Returns the health status of the API.

**Response (200 OK):**
```json
{
  "status": "ok"
}
```

---

## Response Objects

### Conversation Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique conversation ID |
| `userId` | string | Owner's user ID |
| `title` | string | Conversation title |
| `status` | string | Current status (see State Machine docs) |
| `schedule` | object/null | Schedule configuration if background work exists |
| `nextRunAt` | date/null | Next scheduled execution time |
| `state` | object | Conversation state data |
| `createdAt` | date | Creation timestamp |
| `updatedAt` | date | Last update timestamp |

### Schedule Object

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `cron`, `scheduled`, or `immediate` |
| `cronExpression` | string/null | Cron expression for recurring tasks |
| `runAt` | date/null | One-time execution date |

### Message Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique message ID |
| `conversationId` | string | Parent conversation ID |
| `role` | string | `user`, `assistant`, or `system` |
| `content` | string | Message content |
| `source` | string | `chat` (interactive) or `worker` (background) |
| `createdAt` | date | Creation timestamp |

### Notification Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique notification ID |
| `userId` | string | Owner's user ID |
| `conversationId` | string/null | Related conversation if applicable |
| `title` | string | Notification title |
| `body` | string | Notification body text |
| `isRead` | boolean | Read status |
| `createdAt` | date | Creation timestamp |

---

## Error Responses

All error responses follow this format:

```json
{
  "error": "Error message description"
}
```

### Common HTTP Status Codes

| Status | Description |
|--------|-------------|
| 400 | Bad Request - Invalid input data |
| 403 | Forbidden - Resource belongs to another user |
| 404 | Not Found - Resource does not exist |
| 500 | Internal Server Error - Unexpected error |
