
import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { Send, Sparkles, RefreshCw, Edit, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import geminiService from "@/lib/gemini-service";
import chatStorageService, { Message } from "@/lib/chat-storage-service";
import { motion } from "framer-motion";
import { useAuth } from "@/providers/AuthProvider";

// Simple inline message bubble component
function MessageBubble({ content, isUser, timestamp }: { content: string; isUser: boolean; timestamp?: string }) {
  // Function to detect code blocks and format them
  const formatMessageContent = (text: string) => {
    // Check if there are code blocks with ```
    if (text.includes("```")) {
      const parts = text.split(/(```(?:[\w]*\n)?|```)/g);
      let inCodeBlock = false;
      
      return parts.map((part, index) => {
        // Check for opening code fence
        if (part.match(/```(?:[\w]*\n)?/)) {
          inCodeBlock = true;
          // Extract language if specified
          const lang = part.replace(/```([\w]*)\n?/, "$1");
          return null; // Don't render the opening fence
        }
        
        // Check for closing code fence
        if (part === "```") {
          inCodeBlock = false;
          return null; // Don't render the closing fence
        }
        
        if (inCodeBlock) {
          return (
            <div key={index} className="bg-secondary/50 rounded-md p-3 my-2 overflow-x-auto font-mono text-xs">
              <pre className="whitespace-pre-wrap">{part}</pre>
            </div>
          );
        }
        
        // Regular text
        return <span key={index}>{part}</span>;
      });
    }
    
    // If no code blocks, return the text as is
    return text;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex flex-col max-w-[80%] mb-4",
        isUser ? "ml-auto" : "mr-auto"
      )}
    >
      <div
        className={cn(
          "px-4 py-3 rounded-2xl",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-none"
            : "glass-panel rounded-tl-none"
        )}
      >
        <p className="text-sm whitespace-pre-wrap">
          {formatMessageContent(content)}
        </p>
      </div>
      {timestamp && (
        <span className="text-xs text-muted-foreground mt-1 px-1">
          {timestamp}
        </span>
      )}
    </motion.div>
  );
}

interface ChatInterfaceProps {
  ref?: React.RefObject<any>;
}

const ChatInterface = forwardRef<any, ChatInterfaceProps>(({}, ref) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState("New Conversation");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  
  const messageEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  
  const { session } = useAuth();

  // Expose methods to parent component
  useImperativeHandle(ref, () => ({
    handleNewChat,
    handleSelectChat
  }));

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Focus title input when editing
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
    }
  }, [isEditingTitle]);

  // Auto-save messages when they change
  useEffect(() => {
    const saveCurrentChat = async () => {
      if (currentChatId && messages.length > 0) {
        await chatStorageService.saveMessages(currentChatId, messages);
        
        // Update title if it's the first message
        if (messages.length === 1 && messages[0].isUser && chatTitle === "New Conversation") {
          // Create a title from the first message (max 30 chars)
          const newTitle = messages[0].content.length > 30 
            ? `${messages[0].content.substring(0, 27)}...` 
            : messages[0].content;
          
          await chatStorageService.updateChatTitle(currentChatId, newTitle);
          setChatTitle(newTitle);
        }
      }
    };
    
    saveCurrentChat();
  }, [messages, currentChatId, chatTitle]);

  const formatTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;
    
    // Create a new chat if one doesn't exist
    if (!currentChatId) {
      const newChatId = await chatStorageService.createNewChat();
      if (!newChatId) return;
      setCurrentChatId(newChatId);
    }
    
    const userMessage: Message = {
      content: inputValue,
      isUser: true,
      timestamp: formatTimestamp(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    
    try {
      const response = await geminiService.sendMessage(inputValue);
      
      if (response) {
        const aiMessage: Message = {
          content: response.content,
          isUser: false,
          timestamp: formatTimestamp(),
        };
        setMessages(prev => [...prev, aiMessage]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error("Failed to get a response");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setChatTitle("New Conversation");
    setCurrentChatId(null);
    geminiService.createNewChat();
    toast.success("Chat has been reset");
    inputRef.current?.focus();
  };

  const handleSelectChat = async (chatId: string) => {
    setIsLoading(true);
    
    try {
      // Load chat data
      const chat = await chatStorageService.getChatById(chatId);
      if (!chat) throw new Error("Chat not found");
      
      setChatTitle(chat.title);
      
      // Load messages
      const loadedMessages = await chatStorageService.loadMessages(chatId);
      setMessages(loadedMessages);
      
      // Update current chat ID
      setCurrentChatId(chatId);
      
      // Reset Gemini context
      geminiService.createNewChat();
      
      // Replay messages to Gemini to rebuild context
      if (loadedMessages.length > 0) {
        for (const msg of loadedMessages) {
          if (msg.isUser) {
            await geminiService.sendMessage(msg.content);
          }
        }
      }
    } catch (error) {
      console.error('Error loading chat:', error);
      toast.error("Failed to load chat");
    } finally {
      setIsLoading(false);
    }
  };

  const startEditingTitle = () => {
    setEditTitleValue(chatTitle);
    setIsEditingTitle(true);
  };

  const saveTitle = async () => {
    if (currentChatId && editTitleValue.trim()) {
      await chatStorageService.updateChatTitle(currentChatId, editTitleValue);
      setChatTitle(editTitleValue);
    }
    setIsEditingTitle(false);
  };

  const cancelEditingTitle = () => {
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    } else if (e.key === 'Escape') {
      cancelEditingTitle();
    }
  };

  return (
    <div className="flex flex-col h-full max-w-3xl w-full mx-auto">
      {/* Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between pb-4 mb-4 border-b"
      >
        <div className="flex items-center gap-2 flex-1">
          <Sparkles className="h-5 w-5 text-primary animate-pulse-subtle" />
          
          {isEditingTitle ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                ref={titleInputRef}
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onKeyDown={handleTitleKeyDown}
                className="h-8 py-1"
                autoFocus
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={saveTitle}
                className="h-7 w-7"
              >
                <Save className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={cancelEditingTitle}
                className="h-7 w-7"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1">
              <h2 className="text-xl font-semibold truncate">{chatTitle}</h2>
              {currentChatId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={startEditingTitle}
                  className="h-7 w-7 opacity-50 hover:opacity-100"
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Reset</span>
        </Button>
      </motion.div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-2 py-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-center max-w-sm"
            >
              <Sparkles className="h-12 w-12 mx-auto mb-4 text-primary/50 animate-float" />
              <h3 className="text-lg font-medium mb-2">Welcome to Hyper Chat</h3>
              <p className="text-sm">
                Ask me anything or start a conversation. I'm powered by Google's 
                Gemini AI model and here to assist you.
              </p>
            </motion.div>
          </div>
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={index}
              content={message.content}
              isUser={message.isUser}
              timestamp={message.timestamp}
            />
          ))
        )}
        <div ref={messageEndRef} />
      </div>

      {/* Input Area */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-4 pt-4 border-t"
      >
        <div className="relative">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="pr-12 py-6 pl-4 bg-secondary border-none"
            disabled={isLoading}
          />
          <Button
            size="icon"
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 h-8 w-8"
          >
            {isLoading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";

export default ChatInterface;
