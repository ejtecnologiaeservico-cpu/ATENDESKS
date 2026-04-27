# Usar imagem oficial do Node.js
FROM node:18-slim

# Instalar dependências necessárias para o SQLite3 e PDFKit
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências
RUN npm install --production

# Copiar o restante do código
COPY . .

# Expor a porta que o Render/Heroku usarão
EXPOSE 3000

# Comando para iniciar
CMD ["node", "server.js"]
