const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 8000;
const DB_FILE = path.join(__dirname, 'incidents.json');
const USERS_FILE = path.join(__dirname, 'users.json');
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
    date: { type: String, required: true } // Store ISO date strings
});
const IncidentModel = mongoose.models.Incident || mongoose.model('Incident', IncidentSchema);

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
        return JSON.parse(raw);
    } catch (e) {
        console.error("Local database read error:", e);
        return [];
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
            users = JSON.parse(raw);
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
        return {};
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
    const users = getLocalUsers();
    const userData = users[username];
    const userPassword = (userData && typeof userData === 'object') ? userData.password : userData;
    if (userData && userPassword === password) {
        res.json({ success: true, username });
    } else {
        res.status(401).json({ error: "Invalid username or password" });
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

    if (useMongoDB) {
        try {
            const doc = new IncidentModel(newIncident);
            const savedDoc = await doc.save();
            await pruneOldIncidents([], true); // Cleanup database
            return res.status(201).json(savedDoc);
        } catch (e) {
            console.error("MongoDB insert error, falling back to local storage write:", e);
        }
    }

    const localList = getLocalIncidents();
    localList.push(newIncident);
    const activeList = await pruneOldIncidents(localList, false);
    
    if (saveLocalIncidentsList(activeList)) {
        res.status(201).json(newIncident);
    } else {
        res.status(500).json({ error: "Failed to persist report data" });
    }
});

// ----------------------------------------------------
// ADMINISTRATOR API ENDPOINTS
// ----------------------------------------------------

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
