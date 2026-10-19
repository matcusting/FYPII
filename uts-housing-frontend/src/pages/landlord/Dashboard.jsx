import React from 'react';

const Dashboard = ({ myProperties, contacts, setActiveTab, setActiveContactId, setContacts }) => {
    
    const handleJumpToMessage = (contactId) => {
        setActiveTab('messages');
        setActiveContactId(contactId);
        setContacts(contacts.map(c => c.id === contactId ? { ...c, unread: 0 } : c));
    };

    return (
        <div className="p-10 overflow-y-auto animate-fade-in-up">
            <h2 className="text-[1.4rem] font-bold text-[#0f172a] border-b border-gray-100 pb-4 mb-8">Overview Dashboard</h2>
            
            <div className="grid grid-cols-3 gap-6 mb-10">
                <div 
                    onClick={() => setActiveTab('manage')}
                    className="bg-[#eff6ff] rounded-xl p-6 border border-[#bfdbfe] cursor-pointer hover:shadow-md transition"
                >
                    <div className="text-4xl font-bold text-[#1d4ed8] mb-2">
                        {myProperties.filter(p => p.status === 'Active').length}
                    </div>
                    <div className="text-sm font-bold text-[#1d4ed8]">Active Listings →</div>
                </div>
                <div className="bg-[#f0fdf4] rounded-xl p-6 border border-[#bbf7d0]">
                    <div className="text-4xl font-bold text-[#15803d] mb-2">124</div>
                    <div className="text-sm font-bold text-[#15803d]">Total Profile Views</div>
                </div>
                <div 
                    onClick={() => setActiveTab('messages')}
                    className="bg-[#fefce8] rounded-xl p-6 border border-[#fef08a] cursor-pointer hover:shadow-md transition"
                >
                    <div className="text-4xl font-bold text-[#a16207] mb-2">{contacts.length}</div>
                    <div className="text-sm font-bold text-[#a16207]">Student Inquiries →</div>
                </div>
            </div>

            <h3 className="text-[1.1rem] font-bold text-[#0f172a] mb-4">Recent Activity</h3>
            <div className="space-y-0">
                <div 
                    onClick={() => handleJumpToMessage(1)}
                    className="flex items-center justify-between py-4 border-b border-gray-100 hover:bg-gray-50 px-3 rounded-lg cursor-pointer transition"
                >
                    <div className="flex items-center gap-4">
                        <span className="bg-[#dbeafe] text-[#1e40af] text-[11px] font-bold px-3 py-1.5 rounded">Message</span>
                        <span className="text-gray-600 text-sm">Student <strong className="text-gray-900">Marcus Ting</strong> inquired about "Taman Universiti Room".</span>
                    </div>
                    <span className="text-gray-400 text-sm font-medium">2 hours ago</span>
                </div>
                <div 
                    onClick={() => setActiveTab('reviews')}
                    className="flex items-center justify-between py-4 border-b border-gray-100 hover:bg-gray-50 px-3 rounded-lg cursor-pointer transition"
                >
                    <div className="flex items-center gap-4">
                        <span className="bg-[#dcfce7] text-[#166534] text-[11px] font-bold px-3 py-1.5 rounded w-[68px] text-center">Review</span>
                        <span className="text-gray-600 text-sm">Student <strong className="text-gray-900">Amanda K.</strong> left a 5-star review.</span>
                    </div>
                    <span className="text-gray-400 text-sm font-medium">1 day ago</span>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;