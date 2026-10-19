import React, { useState } from 'react';

const Reviews = ({ reviews, setReviews }) => {
    const [replyingToId, setReplyingToId] = useState(null);
    const [replyText, setReplyText] = useState('');

    const handleReplySubmit = (reviewId) => {
        if (!replyText.trim()) return;
        setReviews(reviews.map(r => r.id === reviewId ? { ...r, reply: replyText } : r));
        setReplyingToId(null);
        setReplyText('');
    };

    return (
        <div className="p-10 overflow-y-auto animate-fade-in-up">
            <div className="flex justify-between items-end border-b border-gray-200 pb-4 mb-8 max-w-4xl">
                <h2 className="text-[1.4rem] font-bold text-[#0f172a]">Student Reviews</h2>
                <div className="text-right">
                    <div className="text-3xl font-bold text-[#eab308] flex items-center gap-1 justify-end">
                        4.8 <span className="text-2xl">★</span>
                    </div>
                    <div className="text-[12px] text-gray-500 font-medium">Based on 12 verified reviews</div>
                </div>
            </div>

            <div className="space-y-5 max-w-4xl">
                {reviews.map(review => (
                    <div key={review.id} className="border border-gray-200 rounded-xl p-6 bg-white shadow-sm">
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 ${review.avatarBg} rounded-full flex items-center justify-center font-bold text-lg`}>
                                    {review.avatar}
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-[#0f172a] text-[15px]">{review.student}</h3>
                                        <span className="bg-[#dbeafe] text-[#1d4ed8] text-[10px] font-bold px-2 py-0.5 rounded-full">
                                            Verified UTS Student
                                        </span>
                                    </div>
                                    <p className="text-[12px] text-gray-500 mt-0.5 font-medium">
                                        {review.year} • Rated Property: {review.property}
                                    </p>
                                </div>
                            </div>
                            <div className="text-[#eab308] text-lg tracking-widest">
                                {'★'.repeat(review.rating)}
                                <span className="text-gray-300">{'★'.repeat(5 - review.rating)}</span>
                            </div>
                        </div>
                        
                        <p className="text-gray-600 text-[14px] leading-relaxed mb-4">{review.text}</p>

                        {review.reply ? (
                            <div className="bg-[#f8f9fa] border-l-4 border-[#203569] p-3.5 rounded-r-lg mt-3">
                                <p className="text-xs font-bold text-[#203569] mb-1">Response from Mr. Wong (Landlord):</p>
                                <p className="text-xs text-gray-600">{review.reply}</p>
                            </div>
                        ) : (
                            <div>
                                {replyingToId === review.id ? (
                                    <div className="mt-4 flex gap-2">
                                        <input 
                                            type="text" 
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            placeholder="Write a public response..."
                                            className="flex-1 text-sm p-2 border border-gray-300 rounded-lg outline-none focus:border-[#203569]"
                                        />
                                        <button 
                                            onClick={() => handleReplySubmit(review.id)}
                                            className="bg-[#203569] text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-[#1a2b56] cursor-pointer"
                                        >
                                            Post Reply
                                        </button>
                                        <button 
                                            onClick={() => setReplyingToId(null)}
                                            className="text-gray-500 text-xs font-bold px-3 py-2 hover:bg-gray-100 rounded-lg cursor-pointer"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                ) : (
                                    <button 
                                        onClick={() => { setReplyingToId(review.id); setReplyText(''); }}
                                        className="text-xs font-bold text-[#1d4ed8] hover:underline cursor-pointer"
                                    >
                                        ↪ Reply to this review
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Reviews;