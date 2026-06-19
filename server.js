const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8000;
const DB_FILE = path.join(__dirname, 'incidents.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const RESET_REQUESTS_FILE = path.join(__dirname, 'reset_requests.json');
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware to parse JSON body payloads
app.use(express.json());

// Define Mongoose Schema for MongoDB User Authentication
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    fullName: { type: String, default: "" },
    phone: { type: String, default: "" },
    emergencyContact: { type: String, default: "" },
    autoAnonymous: { type: Boolean, default: true },
    defaultLocation: { type: String, default: "" }
});
const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

// Define Mongoose Schema for MongoDB Incidents
const IncidentSchema = new mongoose.Schema({
    id: { type: String, required: true },
    category: { type: String, required: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    time: { type: String, required: true },
    description: { type: String, required: true },
    anonymous: { type: Boolean, required: true },
    date: { type: String, required: true }, // Store ISO date strings
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    votes: { type: Map, of: String, default: {} }
});
const IncidentModel = mongoose.models.Incident || mongoose.model('Incident', IncidentSchema);

// Define Mongoose Schema for MongoDB Password Reset Requests
const ResetRequestSchema = new mongoose.Schema({
    username: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    newPassword: { type: String, required: true },
    requestedAt: { type: String, required: true }
});
const ResetRequestModel = mongoose.models.ResetRequest || mongoose.model('ResetRequest', ResetRequestSchema);

// Local file helper for reset requests
function getLocalResetRequests() {
    try {
        if (!fs.existsSync(RESET_REQUESTS_FILE)) {
            fs.writeFileSync(RESET_REQUESTS_FILE, JSON.stringify([], null, 2), 'utf8');
            return [];
        }
        const raw = fs.readFileSync(RESET_REQUESTS_FILE, 'utf8');
        if (!raw.trim()) return [];
        return JSON.parse(raw);
    } catch (e) {
        console.error("Local reset requests db read error:", e);
        throw new Error("Database read error: reset_requests.json is invalid JSON or unreadable.");
    }
}

function saveLocalResetRequests(list) {
    try {
        fs.writeFileSync(RESET_REQUESTS_FILE, JSON.stringify(list, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Local reset requests db write error:", e);
        return false;
    }
}

let useMongoDB = false;

// Connect to MongoDB if MONGODB_URI is provided
if (MONGODB_URI) {
    console.log("Connecting to MongoDB online database...");
    mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(async () => {
        console.log("Successfully connected to MongoDB cloud database!");
        useMongoDB = true;
        try {
            const adminExists = await UserModel.findOne({ username: 'admin' });
            if (!adminExists) {
                const adminUser = new UserModel({
                    username: 'admin',
                    password: 'Neel@007',
                    fullName: 'System Administrator',
                    phone: '112',
                    emergencyContact: '112',
                    autoAnonymous: false,
                    defaultLocation: '28.6304,77.2177'
                });
                await adminUser.save();
                console.log("Seeded default admin user into MongoDB.");
            }
        } catch (e) {
            console.error("Failed to seed admin in MongoDB:", e);
        }
    })
    .catch(err => {
        console.error("MongoDB connection failed, falling back to local file storage:", err.message);
        useMongoDB = false;
    });
} else {
    console.log("No MONGODB_URI environment variable detected. Running in Local Storage File mode.");
}

// ----------------------------------------------------
// DATABASE CLEANUP ROUTINE (DELETE LOGS > 30 DAYS OLD)
// ----------------------------------------------------
async function pruneOldIncidents(list, isMongo = false) {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    // Prune MongoDB records if MongoDB is active
    if (isMongo) {
        try {
            await IncidentModel.deleteMany({ date: { $lt: oneMonthAgo.toISOString() } });
        } catch (e) {
            console.error("Error pruning MongoDB incidents:", e);
        }
    }

    // Filter local list
    return list.filter(item => {
        if (!item.date) return false;
        const itemDate = new Date(item.date);
        return !isNaN(itemDate.getTime()) && itemDate >= oneMonthAgo;
    });
}

// Local File Helper Functions
function getLocalIncidents() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf8');
            return [];
        }
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        if (!raw.trim()) return [];
        return JSON.parse(raw);
    } catch (e) {
        console.error("Local database read error:", e);
        throw new Error("Database read error: incidents.json is invalid JSON or unreadable.");
    }
}

function saveLocalIncidentsList(list) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(list, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Local database write error:", e);
        return false;
    }
}

function getLocalUsers() {
    try {
        let users = {};
        if (fs.existsSync(USERS_FILE)) {
            const raw = fs.readFileSync(USERS_FILE, 'utf8');
            if (raw.trim()) {
                users = JSON.parse(raw);
            }
        }
        // Seed default admin if not present
        if (!users['admin']) {
            users['admin'] = {
                password: "Neel@007",
                fullName: "System Administrator",
                phone: "112",
                emergencyContact: "112",
                autoAnonymous: false,
                defaultLocation: "28.6304,77.2177"
            };
            fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        }
        return users;
    } catch (e) {
        console.error("Local users db read error:", e);
        throw new Error("Database read error: users.json is invalid JSON or unreadable.");
    }
}

// Save users local database helper
function saveLocalUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error("Local users db write error:", e);
        return false;
    }
}

let sseClients = [];

function broadcastIncident(incident) {
    const payload = JSON.stringify(incident);
    sseClients.forEach(client => {
        try {
            client.write(`data: ${payload}\n\n`);
        } catch (e) {
            console.error("Failed to push to SSE client:", e);
        }
    });
}

// SSE Connection for Live Notifications
app.get('/api/notifications/subscribe', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish SSE stream

    // Send connection established confirmation
    res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

    sseClients.push(res);

    req.on('close', () => {
        sseClients = sseClients.filter(client => client !== res);
    });
});

// ----------------------------------------------------
// AUTHENTICATION API ENDPOINTS
// ----------------------------------------------------
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    if (useMongoDB) {
        try {
            const exists = await UserModel.findOne({ username });
            if (exists) {
                return res.status(400).json({ error: "Username already exists" });
            }
            const newUser = new UserModel({ username, password });
            await newUser.save();
            return res.status(201).json({ success: true });
        } catch (e) {
            console.error("MongoDB register error, falling back to local file:", e);
        }
    }

    // Local file fallback
    try {
        const users = getLocalUsers();
        if (users[username]) {
            return res.status(400).json({ error: "Username already exists" });
        }
        users[username] = {
            password: password,
            fullName: "",
            phone: "",
            emergencyContact: "",
            autoAnonymous: true,
            defaultLocation: ""
        };
        saveLocalUsers(users);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    if (useMongoDB) {
        try {
            const user = await UserModel.findOne({ username, password });
            if (user) {
                return res.json({ success: true, username });
            } else {
                return res.status(401).json({ error: "Invalid username or password" });
            }
        } catch (e) {
            console.error("MongoDB login error, falling back to local file:", e);
        }
    }

    // Local file fallback
    try {
        const users = getLocalUsers();
        const userData = users[username];
        const userPassword = (userData && typeof userData === 'object') ? userData.password : userData;
        if (userData && userPassword === password) {
            res.json({ success: true, username });
        } else {
            res.status(401).json({ error: "Invalid username or password" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/profile', async (req, res) => {
    const { username } = req.query;
    if (!username) {
        return res.status(400).json({ error: "Username required" });
    }

    if (useMongoDB) {
        try {
            const user = await UserModel.findOne({ username });
            if (user) {
                return res.json({
                    fullName: user.fullName || "",
                    phone: user.phone || "",
                    emergencyContact: user.emergencyContact || "",
                    autoAnonymous: user.autoAnonymous !== false,
                    defaultLocation: user.defaultLocation || ""
                });
            }
        } catch (e) {
            console.error("MongoDB get profile error, falling back to local file:", e);
        }
    }

    // Local file fallback
    try {
        const users = getLocalUsers();
        const userData = users[username];
        if (userData) {
            if (typeof userData === 'object') {
                return res.json({
                    fullName: userData.fullName || "",
                    phone: userData.phone || "",
                    emergencyContact: userData.emergencyContact || "",
                    autoAnonymous: userData.autoAnonymous !== false,
                    defaultLocation: userData.defaultLocation || ""
                });
            } else {
                return res.json({
                    fullName: "",
                    phone: "",
                    emergencyContact: "",
                    autoAnonymous: true,
                    defaultLocation: ""
                });
            }
        }
        res.status(404).json({ error: "User not found" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/profile', async (req, res) => {
    const { username, fullName, phone, emergencyContact, autoAnonymous, defaultLocation } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Username required" });
    }

    if (useMongoDB) {
        try {
            const user = await UserModel.findOneAndUpdate(
                { username },
                { fullName, phone, emergencyContact, autoAnonymous, defaultLocation },
                { new: true }
            );
            if (user) {
                return res.json({ success: true });
            }
        } catch (e) {
            console.error("MongoDB save profile error, falling back to local file:", e);
        }
    }

    // Local file fallback
    try {
        const users = getLocalUsers();
        const userData = users[username];
        if (userData) {
            if (typeof userData === 'object') {
                users[username] = {
                    ...userData,
                    fullName,
                    phone,
                    emergencyContact,
                    autoAnonymous,
                    defaultLocation
                };
            } else {
                users[username] = {
                    password: userData,
                    fullName,
                    phone,
                    emergencyContact,
                    autoAnonymous,
                    defaultLocation
                };
            }
            saveLocalUsers(users);
            return res.json({ success: true });
        }
        res.status(404).json({ error: "User not found" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----------------------------------------------------
// PASSWORD RESET REQUESTS API ENDPOINTS
// ----------------------------------------------------

app.post('/api/reset-request', async (req, res) => {
    const { username, fullName, phone, newPassword } = req.body;
    if (!username || !fullName || !phone || !newPassword) {
        return res.status(400).json({ error: "All fields are required" });
    }

    let userExists = false;
    if (useMongoDB) {
        try {
            const user = await UserModel.findOne({ username });
            if (user) userExists = true;
        } catch (e) {
            console.error("MongoDB check user error:", e);
        }
    } else {
        const users = getLocalUsers();
        if (users[username]) userExists = true;
    }

    if (!userExists) {
        return res.status(404).json({ error: "Username not found in system directory" });
    }

    // Save reset request
    const requestedAt = new Date().toISOString();
    if (useMongoDB) {
        try {
            // Remove any existing reset request for this user first
            await ResetRequestModel.deleteOne({ username });
            const newReq = new ResetRequestModel({ username, fullName, phone, newPassword, requestedAt });
            await newReq.save();
            return res.status(201).json({ success: true, message: "Reset request submitted to Administrator." });
        } catch (e) {
            console.error("MongoDB save reset request error:", e);
        }
    }

    // Local file fallback
    const list = getLocalResetRequests();
    // Filter out previous request for this user
    const filtered = list.filter(r => r.username !== username);
    filtered.push({ username, fullName, phone, newPassword, requestedAt });
    saveLocalResetRequests(filtered);
    res.status(201).json({ success: true, message: "Reset request submitted to Administrator." });
});

app.get('/api/admin/reset-requests', async (req, res) => {
    if (useMongoDB) {
        try {
            const list = await ResetRequestModel.find({});
            return res.json(list);
        } catch (e) {
            console.error("MongoDB get reset requests error:", e);
        }
    }
    const list = getLocalResetRequests();
    res.json(list);
});

app.post('/api/admin/reset-requests/approve', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Username required" });
    }

    let newPassword = null;
    if (useMongoDB) {
        try {
            const request = await ResetRequestModel.findOne({ username });
            if (request) {
                newPassword = request.newPassword;
                // Update user password
                await UserModel.findOneAndUpdate({ username }, { password: newPassword });
                // Delete request
                await ResetRequestModel.deleteOne({ username });
                return res.json({ success: true });
            }
        } catch (e) {
            console.error("MongoDB approve reset error:", e);
            return res.status(500).json({ error: "Internal server error" });
        }
    } else {
        const requests = getLocalResetRequests();
        const request = requests.find(r => r.username === username);
        if (request) {
            newPassword = request.newPassword;
            
            // Update user password
            const users = getLocalUsers();
            if (users[username]) {
                if (typeof users[username] === 'object') {
                    users[username].password = newPassword;
                } else {
                    users[username] = {
                        password: newPassword,
                        fullName: "",
                        phone: "",
                        emergencyContact: "",
                        autoAnonymous: true,
                        defaultLocation: ""
                    };
                }
                saveLocalUsers(users);
            }
            
            // Delete request
            const filtered = requests.filter(r => r.username !== username);
            saveLocalResetRequests(filtered);
            return res.json({ success: true });
        }
    }

    res.status(404).json({ error: "Reset request not found" });
});

app.post('/api/admin/reset-requests/reject', async (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Username required" });
    }

    if (useMongoDB) {
        try {
            await ResetRequestModel.deleteOne({ username });
            return res.json({ success: true });
        } catch (e) {
            console.error("MongoDB reject reset error:", e);
            return res.status(500).json({ error: "Internal server error" });
        }
    } else {
        const requests = getLocalResetRequests();
        const filtered = requests.filter(r => r.username !== username);
        if (requests.length !== filtered.length) {
            saveLocalResetRequests(filtered);
            return res.json({ success: true });
        }
    }

    res.status(404).json({ error: "Reset request not found" });
});

// ----------------------------------------------------
// INCIDENTS API ENDPOINTS
// ----------------------------------------------------
app.get('/api/incidents', async (req, res) => {
    if (useMongoDB) {
        try {
            // Prune old records first
            await pruneOldIncidents([], true);
            const list = await IncidentModel.find({});
            return res.json(list);
        } catch (e) {
            console.error("MongoDB retrieve error, loading local fallback:", e);
        }
    }
    
    // Local file incidents loading with pruning
    const localList = getLocalIncidents();
    const activeList = await pruneOldIncidents(localList, false);
    if (localList.length !== activeList.length) {
        saveLocalIncidentsList(activeList);
    }
    res.json(activeList);
});

app.post('/api/incidents', async (req, res) => {
    const newIncident = req.body;
    if (!newIncident || !newIncident.category || !newIncident.lat || !newIncident.lng) {
        return res.status(400).json({ error: "Invalid incident payload" });
    }

    // Force date to ISO String format for clean date comparisons
    newIncident.date = new Date().toISOString();
    newIncident.upvotes = 0;
    newIncident.downvotes = 0;
    newIncident.votes = {};

    if (useMongoDB) {
        try {
            const doc = new IncidentModel(newIncident);
            const savedDoc = await doc.save();
            await pruneOldIncidents([], true); // Cleanup database
            const incidentObj = savedDoc.toObject ? savedDoc.toObject() : savedDoc;
            broadcastIncident(incidentObj);
            return res.status(201).json(savedDoc);
        } catch (e) {
            console.error("MongoDB insert error, falling back to local storage write:", e);
        }
    }

    const localList = getLocalIncidents();
    localList.push(newIncident);
    const activeList = await pruneOldIncidents(localList, false);
    
    if (saveLocalIncidentsList(activeList)) {
        broadcastIncident(newIncident);
        res.status(201).json(newIncident);
    } else {
        res.status(500).json({ error: "Failed to persist report data" });
    }
});

app.post('/api/incidents/:id/vote', async (req, res) => {
    const { id } = req.params;
    const { voteType, username } = req.body; // voteType is 'up' or 'down'
    if (!voteType || !username) {
        return res.status(400).json({ error: "voteType and username required" });
    }

    if (useMongoDB) {
        try {
            const incident = await IncidentModel.findOne({ id });
            if (incident) {
                // Initialize map if not present
                if (!incident.votes) incident.votes = new Map();
                
                const currentVote = incident.votes.get(username);
                if (currentVote === voteType) {
                    // Clicked same vote again: remove vote (toggle off)
                    incident.votes.delete(username);
                } else {
                    // Vote or change vote
                    incident.votes.set(username, voteType);
                }

                // Recalculate upvotes and downvotes
                let up = 0;
                let down = 0;
                incident.votes.forEach((v) => {
                    if (v === 'up') up++;
                    if (v === 'down') down++;
                });

                incident.upvotes = up;
                incident.downvotes = down;

                // Mark modified since we are changing Map contents in Mongoose
                incident.markModified('votes');
                const saved = await incident.save();

                // Convert votes map to object for response JSON
                const votesObj = {};
                saved.votes.forEach((v, k) => { votesObj[k] = v; });

                return res.json({
                    success: true,
                    upvotes: saved.upvotes,
                    downvotes: saved.downvotes,
                    votes: votesObj
                });
            }
        } catch (e) {
            console.error("MongoDB incident vote error:", e);
        }
    }

    // Local file fallback
    try {
        const localList = getLocalIncidents();
        const incident = localList.find(i => i.id === id);
        if (incident) {
            if (!incident.votes) incident.votes = {};
            if (incident.upvotes === undefined) incident.upvotes = 0;
            if (incident.downvotes === undefined) incident.downvotes = 0;

            const currentVote = incident.votes[username];
            if (currentVote === voteType) {
                delete incident.votes[username];
            } else {
                incident.votes[username] = voteType;
            }

            // Recalculate upvotes and downvotes
            let up = 0;
            let down = 0;
            for (let u in incident.votes) {
                if (incident.votes[u] === 'up') up++;
                if (incident.votes[u] === 'down') down++;
            }

            incident.upvotes = up;
            incident.downvotes = down;

            saveLocalIncidentsList(localList);
            return res.json({
                success: true,
                upvotes: incident.upvotes,
                downvotes: incident.downvotes,
                votes: incident.votes
            });
        }
        return res.status(404).json({ error: "Incident not found" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ----------------------------------------------------
// ADMINISTRATOR API ENDPOINTS
// ----------------------------------------------------

// POST create a new user/citizen from admin
app.post('/api/admin/users/create', async (req, res) => {
    const { username, password, fullName, phone, emergencyContact, autoAnonymous, defaultLocation } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    if (useMongoDB) {
        try {
            const exists = await UserModel.findOne({ username });
            if (exists) {
                return res.status(400).json({ error: "Username already exists" });
            }
            const newUser = new UserModel({
                username,
                password,
                fullName: fullName || "",
                phone: phone || "",
                emergencyContact: emergencyContact || "",
                autoAnonymous: autoAnonymous !== false,
                defaultLocation: defaultLocation || ""
            });
            await newUser.save();
            return res.status(201).json({ success: true });
        } catch (e) {
            console.error("MongoDB create user admin error, falling back to local file:", e);
        }
    }

    // Local file fallback
    try {
        const users = getLocalUsers();
        if (users[username]) {
            return res.status(400).json({ error: "Username already exists" });
        }
        users[username] = {
            password,
            fullName: fullName || "",
            phone: phone || "",
            emergencyContact: emergencyContact || "",
            autoAnonymous: autoAnonymous !== false,
            defaultLocation: defaultLocation || ""
        };
        saveLocalUsers(users);
        res.status(201).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET all registered users
app.get('/api/admin/users', async (req, res) => {
    if (useMongoDB) {
        try {
            const list = await UserModel.find({}, 'username fullName phone emergencyContact');
            return res.json(list);
        } catch (e) {
            console.error("MongoDB get users admin error, falling back to local file:", e);
        }
    }

    const users = getLocalUsers();
    const list = Object.keys(users).map(username => {
        const u = users[username];
        return {
            username,
            fullName: typeof u === 'object' ? u.fullName || "" : "",
            phone: typeof u === 'object' ? u.phone || "" : "",
            emergencyContact: typeof u === 'object' ? u.emergencyContact || "" : ""
        };
    });
    res.json(list);
});

// DELETE a registered user
app.delete('/api/admin/users/:username', async (req, res) => {
    const { username } = req.params;
    if (username === 'admin') {
        return res.status(400).json({ error: "Cannot delete default admin user account." });
    }

    if (useMongoDB) {
        try {
            await UserModel.deleteOne({ username });
            return res.json({ success: true });
        } catch (e) {
            console.error("MongoDB delete user error, falling back to local file:", e);
        }
    }

    const users = getLocalUsers();
    if (users[username]) {
        delete users[username];
        saveLocalUsers(users);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "User not found" });
});

app.get('/api/admin/users/:username', async (req, res) => {
    const { username } = req.params;

    if (useMongoDB) {
        try {
            const user = await UserModel.findOne({ username });
            if (user) {
                return res.json({
                    username: user.username,
                    password: user.password,
                    fullName: user.fullName || "",
                    phone: user.phone || "",
                    emergencyContact: user.emergencyContact || "",
                    autoAnonymous: user.autoAnonymous !== false,
                    defaultLocation: user.defaultLocation || ""
                });
            }
        } catch (e) {
            console.error("MongoDB get user admin error, falling back to local file:", e);
        }
    }

    const users = getLocalUsers();
    const userData = users[username];
    if (userData) {
        if (typeof userData === 'object') {
            return res.json({
                username,
                password: userData.password,
                fullName: userData.fullName || "",
                phone: userData.phone || "",
                emergencyContact: userData.emergencyContact || "",
                autoAnonymous: userData.autoAnonymous !== false,
                defaultLocation: userData.defaultLocation || ""
            });
        } else {
            return res.json({
                username,
                password: userData,
                fullName: "",
                phone: "",
                emergencyContact: "",
                autoAnonymous: true,
                defaultLocation: ""
            });
        }
    }
    res.status(404).json({ error: "User not found" });
});

app.post('/api/admin/users/:username', async (req, res) => {
    const { username } = req.params;
    const { password, fullName, phone, emergencyContact, autoAnonymous, defaultLocation } = req.body;

    if (useMongoDB) {
        try {
            const user = await UserModel.findOneAndUpdate(
                { username },
                { password, fullName, phone, emergencyContact, autoAnonymous, defaultLocation },
                { new: true }
            );
            if (user) {
                return res.json({ success: true });
            }
        } catch (e) {
            console.error("MongoDB save user admin error, falling back to local file:", e);
        }
    }

    const users = getLocalUsers();
    const userData = users[username];
    if (userData) {
        users[username] = {
            password,
            fullName,
            phone,
            emergencyContact,
            autoAnonymous,
            defaultLocation
        };
        saveLocalUsers(users);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "User not found" });
});

// DELETE an incident report
app.delete('/api/admin/incidents/:id', async (req, res) => {
    const { id } = req.params;

    if (useMongoDB) {
        try {
            await IncidentModel.deleteOne({ id });
            return res.json({ success: true });
        } catch (e) {
            console.error("MongoDB delete incident error, falling back to local file:", e);
        }
    }

    const localList = getLocalIncidents();
    const filtered = localList.filter(item => item.id !== id);
    if (localList.length !== filtered.length) {
        saveLocalIncidentsList(filtered);
        return res.json({ success: true });
    }
    res.status(404).json({ error: "Incident not found" });
});

// POST manual database purge
app.post('/api/admin/purge', async (req, res) => {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    let deletedCount = 0;

    if (useMongoDB) {
        try {
            const beforeCount = await IncidentModel.countDocuments({});
            await IncidentModel.deleteMany({ date: { $lt: oneMonthAgo.toISOString() } });
            const afterCount = await IncidentModel.countDocuments({});
            deletedCount = beforeCount - afterCount;
            return res.json({ success: true, prunedCount: deletedCount });
        } catch (e) {
            console.error("MongoDB purge error, falling back to local file:", e);
        }
    }

    const localList = getLocalIncidents();
    const activeList = localList.filter(item => {
        if (!item.date) return false;
        const itemDate = new Date(item.date);
        return !isNaN(itemDate.getTime()) && itemDate >= oneMonthAgo;
    });

    deletedCount = localList.length - activeList.length;
    if (deletedCount > 0) {
        saveLocalIncidentsList(activeList);
    }
    res.json({ success: true, prunedCount: deletedCount });
});

// Serve static dashboard web pages
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`ADHARM VINASH SERVER RUNNING AT: http://localhost:${PORT}`);
    if (MONGODB_URI) {
        console.log(`Database engine: MongoDB Cloud`);
    } else {
        console.log(`Database engine: Local File Persistence (${DB_FILE})`);
    }
    console.log(`====================================================`);
});
