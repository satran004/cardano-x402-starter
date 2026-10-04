FROM eclipse-temurin:21-jdk AS build
WORKDIR /src
COPY gradlew build.gradle settings.gradle ./
COPY gradle ./gradle
COPY src ./src
RUN ./gradlew --no-daemon test bootJar
FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 demo
COPY --from=build /src/build/libs/*.jar app.jar
USER demo
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
