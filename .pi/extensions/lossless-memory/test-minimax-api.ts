/**
 * MiniMax API 测试脚本
 */

const API_KEY = "sk-cp-w4KKnnlDoUCIGX6bp1IXFfa8FKXPLK-3mrX0NX5m7WS6JjXN26R4Spk3h8fvEyOkN4vWpchAH3Sm1lXNA34KhX0KwnLZLNpYMsVziDOPCcwr02A0M0914ZA";
const BASE_URL = "https://api.minimaxi.com/v1";
const MODEL = "MiniMax-M2.5";

async function testMiniMaxAPI() {
  console.log("测试 MiniMax API...\n");
  console.log(`API URL: ${BASE_URL}/chat/completions`);
  console.log(`Model: ${MODEL}\n`);

  const prompt = `评估摘要质量，返回 JSON：
{"clarity":85,"completeness":80,"coherence":75,"actionability":70}

原始内容：这是一个关于 API 认证的讨论。用户询问如何实现安全的用户认证，助手建议使用 JWT + OAuth 2.0 组合方案。
摘要内容：关于 API 认证的讨论：用户询问了最佳实践，助手推荐了具体方案。

评分标准：
- 清晰度：语言简洁易懂
- 完整性：保留关键信息
- 连贯性：逻辑结构合理
- 可操作性：包含足够细节

只返回 JSON，不要其他文字。`;

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ API 错误: ${response.status} - ${errorText}`);
      return;
    }

    const data = await response.json();
    console.log("📥 完整 API 响应:");
    console.log(JSON.stringify(data, null, 2));
    
    const content = data.choices?.[0]?.message?.content || '';
    console.log("\n📝 返回内容:");
    console.log(content);
    
    // 移除思考标签
    const cleanedContent = content.replace(/<think[\s\S]*?<\/think>/g, '').trim();
    console.log("\n🧹 清理后的内容:");
    console.log(cleanedContent);
    
    // 尝试提取 JSON
    const jsonMatch = cleanedContent.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      console.log("\n✅ 找到 JSON:");
      console.log(jsonMatch[0]);
      const result = JSON.parse(jsonMatch[0]);
      console.log("\n📊 解析结果:");
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("\n⚠️  未找到 JSON 格式");
    }
    
  } catch (error) {
    console.error("❌ 测试失败:", error);
  }
}

testMiniMaxAPI();
